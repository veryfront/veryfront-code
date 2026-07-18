import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { DiscoveryResult } from "#veryfront/discovery";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import { clearTrackedAgents, createProjectDiscoveryConfig } from "#veryfront/discovery";
import { tryGetRegistryScopeContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import type { HandlerContext } from "../../types.ts";

const logger = serverLogger.component("api-wrapper");

/**
 * Tracks in-flight and completed primitive discovery per project+release.
 *
 * Key: `{projectSlug}:{releaseId}` for production, `{projectSlug}:preview` for preview.
 * This ensures a new deployment triggers re-discovery of agents/tools.
 *
 * Using a Map<string, Promise> deduplicates concurrent requests and
 * allows retry on failure (the key is deleted if discovery rejects).
 */
interface DiscoveryRecord {
  promise: Promise<DiscoveryResult>;
}

const discoveredProjects = new LRUCacheAdapter({ maxEntries: 1000 });
const MAX_DISCOVERY_FAILURES_TO_LOG = 5;
const MAX_DISCOVERY_ERROR_MESSAGE_LENGTH = 500;

const DISCOVERY_SOURCE_KINDS: Readonly<Record<string, string>> = {
  agents: "agent",
  evals: "eval",
  prompts: "prompt",
  resources: "resource",
  schedules: "schedule",
  skills: "skill",
  tasks: "task",
  tools: "tool",
  webhooks: "webhook",
  workflows: "workflow",
};

function withoutFileProtocol(path: string): string {
  return path.replace(/^file:\/\//, "").replaceAll("\\", "/");
}

function projectRelativeDiscoveryFile(file: string, projectDir: string): string {
  const normalizedFile = withoutFileProtocol(file);
  const normalizedProjectDir = withoutFileProtocol(projectDir).replace(/\/$/, "");

  if (normalizedProjectDir && normalizedFile.startsWith(`${normalizedProjectDir}/`)) {
    return normalizedFile.slice(normalizedProjectDir.length + 1);
  }
  if (!normalizedFile.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedFile)) {
    return normalizedFile.replace(/^\.\//, "");
  }

  const segments = normalizedFile.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || "unknown";
}

function sanitizeDiscoveryErrorMessage(
  message: string,
  file: string,
  projectDir: string,
  relativeFile: string,
): string {
  let sanitized = sanitizeUrlCredentials(message);
  const normalizedFile = withoutFileProtocol(file);
  const normalizedProjectDir = withoutFileProtocol(projectDir).replace(/\/$/, "");

  for (const path of [file, normalizedFile]) {
    if (path) sanitized = sanitized.replaceAll(path, relativeFile);
  }
  if (normalizedProjectDir) {
    sanitized = sanitized.replaceAll(normalizedProjectDir, "<project>");
  }

  return sanitized.length <= MAX_DISCOVERY_ERROR_MESSAGE_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_DISCOVERY_ERROR_MESSAGE_LENGTH - 3)}...`;
}

function summarizeDiscoveryFailures(
  errors: DiscoveryResult["errors"],
  projectDir: string,
): Array<{ file: string; sourceKind: string; message: string }> {
  return errors.slice(0, MAX_DISCOVERY_FAILURES_TO_LOG).map(({ file, error }) => {
    const relativeFile = projectRelativeDiscoveryFile(file, projectDir);
    const topLevelDir = relativeFile.split("/", 1)[0] ?? "";
    return {
      file: relativeFile,
      sourceKind: DISCOVERY_SOURCE_KINDS[topLevelDir] ?? "unknown",
      message: sanitizeDiscoveryErrorMessage(error.message, file, projectDir, relativeFile),
    };
  });
}

/** Build a discovery cache key that incorporates the release/version. */
function discoveryKey(ctx: HandlerContext): string {
  const registryScope = tryGetRegistryScopeContext();
  if (registryScope) {
    return registryScope.scopeId;
  }

  const slug = ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.releaseId ? "production" : "preview");

  if (environment === "production") {
    return ctx.releaseId ? `${slug}:release:${ctx.releaseId}` : `${slug}:production:unreleased`;
  }

  const branch = ctx.requestContext?.branch ?? ctx.enriched?.branch ?? ctx.parsedDomain?.branch ??
    "main";
  return `${slug}:preview:${branch}`;
}

function shouldCacheCompletedDiscovery(ctx: HandlerContext): boolean {
  const registryScope = tryGetRegistryScopeContext();
  if (registryScope) {
    return registryScope.immutable;
  }

  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.releaseId ? "production" : "preview");
  return environment === "production" && !!ctx.releaseId;
}

/**
 * Run primitive discovery (agents, tools) for a project if not already done.
 * Must be called within a runWithContext scope so the VFS can resolve
 * the correct remote project files and the agent registry uses the
 * correct project scope.
 */
export async function ensureProjectDiscovery(ctx: HandlerContext): Promise<DiscoveryResult> {
  const key = discoveryKey(ctx);
  const cacheCompletedDiscovery = shouldCacheCompletedDiscovery(ctx);

  const existing = discoveredProjects.get<DiscoveryRecord>(key);
  if (existing) return existing.promise;

  const discovery = {
    promise: (async () => {
      const { clearTranspileCache, discoverAll } = await import("#veryfront/discovery");
      const { agentRegistry } = await import(
        "#veryfront/agent/composition/composition.ts"
      );
      const { toolRegistry } = await import("#veryfront/tool/registry.ts");

      return await runWithRegistryTransaction(async () => {
        // Clear stale entries in a transaction-local copy. Concurrent runs keep
        // using the prior live registry until discovery succeeds and the staged
        // replacement is committed atomically.
        clearTrackedAgents();
        clearTranspileCache();
        agentRegistry.clear();
        toolRegistry.clear();

        const discoveryOptions = createProjectDiscoveryConfig({
          projectDir: ctx.projectDir,
          config: ctx.config,
          fsAdapter: ctx.adapter.fs,
        });
        const result = await discoverAll(discoveryOptions);
        const shouldWarnOnEmptyAiDiscovery = discoveryOptions.toolDirs.length > 0 ||
          discoveryOptions.agentDirs.length > 0;

        const logData = {
          projectSlug: ctx.projectSlug,
          releaseId: ctx.releaseId,
          agents: result.agents.size,
          tools: result.tools.size,
          errors: result.errors.length,
        };

        if (result.errors.length > 0) {
          logger.warn("Primitive discovery completed with errors", {
            ...logData,
            failures: summarizeDiscoveryFailures(result.errors, ctx.projectDir),
            omittedErrors: Math.max(0, result.errors.length - MAX_DISCOVERY_FAILURES_TO_LOG),
          });
        } else if (
          result.agents.size === 0 && result.tools.size === 0 && shouldWarnOnEmptyAiDiscovery
        ) {
          logger.info("Primitive discovery found 0 agents and 0 tools", logData);
        } else {
          logger.info("Primitive discovery completed", logData);
        }

        return result;
      });
    })(),
  };

  discoveredProjects.set(key, discovery);

  try {
    return await discovery.promise;
  } catch (error) {
    // Allow retry on next request
    discoveredProjects.delete(key);
    logger.warn("Primitive discovery failed (will retry)", {
      projectSlug: ctx.projectSlug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw INITIALIZATION_ERROR.create({
      detail: `Runtime discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      cause: error,
    });
  } finally {
    if (!cacheCompletedDiscovery) {
      const current = discoveredProjects.get(key);
      if (current === discovery) {
        discoveredProjects.delete(key);
      }
    }
  }
}
