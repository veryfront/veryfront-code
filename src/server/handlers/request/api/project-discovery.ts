import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { DiscoveryResult } from "#veryfront/discovery";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import { clearTrackedAgents, createProjectDiscoveryConfig } from "#veryfront/discovery";
import { tryGetRegistryScopeContext } from "#veryfront/cache/cache-key-builder.ts";
import { runWithRegistryTransaction } from "#veryfront/registry/project-scoped-registry-manager.ts";
import { sanitizeUrlCredentials } from "#veryfront/utils/logger/redact.ts";
import { HOST_PROJECT_EXECUTION_OVERRIDE_ENV } from "#veryfront/security/host-execution-policy.ts";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
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
  sourceSnapshotVersion?: number;
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

  const projectIdentity = ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.releaseId ? "production" : "preview");

  if (environment === "production") {
    return ctx.releaseId
      ? `${projectIdentity}:release:${ctx.releaseId}`
      : `${projectIdentity}:production:unreleased`;
  }

  const branch = ctx.requestContext?.branch ?? ctx.enriched?.branch ?? ctx.parsedDomain?.branch ??
    "main";
  return `${projectIdentity}:preview:${branch}`;
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
  if (requiresIsolatedProjectRuntime(ctx)) {
    // Log the denial with its inputs. This surfaced as an undiagnosable 500 for
    // a full day because the reason never reached the response or the logs.
    logger.warn("Denied executable discovery in a shared runtime", {
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      // The lever, for an operator whose runtime is meant to be the executor.
      overrideEnv: HOST_PROJECT_EXECUTION_OVERRIDE_ENV,
    });
    throw INITIALIZATION_ERROR.create({
      detail:
        "Remote executable discovery requires an isolated project runtime and cannot run in the shared host",
    });
  }

  await ctx.adapter.fs.ensureSourceSnapshotFresh?.("primitive-discovery");
  const key = discoveryKey(ctx);
  const sourceSnapshotVersion = await ctx.adapter.fs.getSourceSnapshotVersion?.();
  const cacheCompletedDiscovery = shouldCacheCompletedDiscovery(ctx) ||
    sourceSnapshotVersion !== undefined;

  const existing = discoveredProjects.get<DiscoveryRecord>(key);
  if (
    existing &&
    (sourceSnapshotVersion === undefined ||
      existing.sourceSnapshotVersion === sourceSnapshotVersion)
  ) {
    return existing.promise;
  }

  const discovery = {
    sourceSnapshotVersion,
    promise: (async () => {
      return await runWithRegistryTransaction(async () => {
        const { discoverAll } = await import("#veryfront/discovery");
        const { agentRegistry } = await import(
          "#veryfront/agent/composition/composition.ts"
        );
        const { toolRegistry } = await import("#veryfront/tool/registry.ts");

        // Clear stale entries in a transaction-local copy. Concurrent runs keep
        // using the prior live registry until discovery succeeds and the staged
        // replacement is committed atomically.
        // Keep the content-aware transpile cache: preview discovery runs on every
        // API request, and clearing it would import unchanged modules under new
        // temporary URLs that the runtime's ESM module map cannot unload.
        clearTrackedAgents();
        agentRegistry.clear();
        toolRegistry.clear();

        const discoveryOptions = createProjectDiscoveryConfig({
          projectDir: ctx.projectDir,
          cacheNamespace: sourceSnapshotVersion === undefined
            ? key
            : `${key}:snapshot:${sourceSnapshotVersion}`,
          config: ctx.config,
          fsAdapter: ctx.adapter.fs,
          // Correct by construction, unlike a bare literal elsewhere: the
          // requiresIsolatedProjectRuntime guard at the top of this function
          // means control cannot reach here without the capability.
          allowHostProjectCodeExecution: true,
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
          logger.debug("Primitive discovery found 0 agents and 0 tools", logData);
        } else {
          logger.debug("Primitive discovery completed", logData);
        }

        return result;
      });
    })(),
  };

  discoveredProjects.set(key, discovery);

  try {
    const result = await discovery.promise;
    if (result.errors.length > 0) {
      const current = discoveredProjects.get<DiscoveryRecord>(key);
      if (current === discovery) {
        discoveredProjects.delete(key);
      }
    }
    return result;
  } catch (error) {
    // A superseded generation may already own this key. Delete only our own
    // record so the newer discovery remains reusable after it completes.
    const current = discoveredProjects.get<DiscoveryRecord>(key);
    if (current === discovery) {
      discoveredProjects.delete(key);
    }
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

/**
 * Drop completed and in-flight discovery records for every source scope owned
 * by a project. The next scoped request rebuilds registries transactionally
 * from its current source snapshot.
 */
export function clearProjectDiscoveryCacheForProject(projectId: string): void {
  for (const key of discoveredProjects.keys()) {
    if (key === projectId || key.startsWith(`${projectId}:`)) {
      discoveredProjects.delete(key);
    }
  }
}
