import { getErrorMessage, INITIALIZATION_ERROR } from "#veryfront/errors";
import {
  createProjectDiscoveryConfig,
  DiscoveryGenerationError,
  replaceDiscoveredProjectPrimitives,
} from "#veryfront/discovery";
import type { DiscoveryResult } from "#veryfront/discovery";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import {
  isRegistryScopeForProject,
  tryGetRegistryScopeContext,
} from "#veryfront/cache/cache-key-builder.ts";
import {
  clearProjectRegistryScopes,
  registerRegistryScopeEvictionListener,
} from "#veryfront/registry/project-scoped-registry-manager.ts";
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
  projectIdentity: string;
  sourceSnapshotVersion?: number;
}

const discoveredProjects = new LRUCacheAdapter({ maxEntries: 1000 });
registerRegistryScopeEvictionListener((scopeId) => {
  discoveredProjects.delete(scopeId);
});
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

function sanitizeRuntimeDiscoveryError(error: unknown): string {
  const sanitized = sanitizeUrlCredentials(getErrorMessage(error));
  return sanitized.length <= MAX_DISCOVERY_ERROR_MESSAGE_LENGTH
    ? sanitized
    : `${sanitized.slice(0, MAX_DISCOVERY_ERROR_MESSAGE_LENGTH - 3)}...`;
}

function summarizeDiscoveryFailures(
  errors: DiscoveryResult["errors"],
  projectDir: string,
): Array<{ file: string; sourceKind: string; message: string }> {
  return errors.slice(0, MAX_DISCOVERY_FAILURES_TO_LOG).map(
    ({ file, error, sourceKind }) => {
      const relativeFile = projectRelativeDiscoveryFile(file, projectDir);
      const topLevelDir = relativeFile.split("/", 1)[0] ?? "";
      return {
        file: relativeFile,
        sourceKind: sourceKind ?? DISCOVERY_SOURCE_KINDS[topLevelDir] ?? "unknown",
        message: sanitizeDiscoveryErrorMessage(
          getErrorMessage(error),
          file,
          projectDir,
          relativeFile,
        ),
      };
    },
  );
}

interface DiscoveryGenerationFailureSummary {
  readonly agents: number;
  readonly tools: number;
  readonly errors: number;
  readonly failures: ReturnType<typeof summarizeDiscoveryFailures>;
  readonly omittedErrors: number;
}

/**
 * Classify and snapshot the one framework-owned aggregate error without
 * allowing a hostile proxy thrown by project or adapter code to escape while
 * JavaScript evaluates `instanceof` or reads fields.
 */
function snapshotDiscoveryGenerationFailure(
  error: unknown,
  projectDir: string,
): DiscoveryGenerationFailureSummary | null {
  try {
    if (!(error instanceof DiscoveryGenerationError)) return null;
    const result = error.result;
    return {
      agents: result.agents.size,
      tools: result.tools.size,
      errors: result.errors.length,
      failures: summarizeDiscoveryFailures(result.errors, projectDir),
      omittedErrors: Math.max(
        0,
        result.errors.length - MAX_DISCOVERY_FAILURES_TO_LOG,
      ),
    };
  } catch {
    return null;
  }
}

function createRuntimeDiscoveryError(error: unknown) {
  return INITIALIZATION_ERROR.create({
    detail: `Runtime discovery failed: ${sanitizeRuntimeDiscoveryError(error)}`,
    cause: error,
  });
}

function logRetryableDiscoveryFailure(ctx: HandlerContext, error: unknown): void {
  logger.warn("Primitive discovery failed (will retry)", {
    projectSlug: ctx.projectSlug,
    error: sanitizeRuntimeDiscoveryError(error),
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
  let key: string;
  let sourceSnapshotVersion: number | undefined;
  let cacheCompletedDiscovery: boolean;
  try {
    await ctx.adapter.fs.ensureSourceSnapshotFresh?.("primitive-discovery");
    key = discoveryKey(ctx);
    sourceSnapshotVersion = await ctx.adapter.fs.getSourceSnapshotVersion?.();
    cacheCompletedDiscovery = shouldCacheCompletedDiscovery(ctx) ||
      sourceSnapshotVersion !== undefined;
  } catch (error) {
    // No cache record exists yet, so the next request always retries the
    // adapter/configuration preflight from a clean state.
    logRetryableDiscoveryFailure(ctx, error);
    throw createRuntimeDiscoveryError(error);
  }

  const existing = discoveredProjects.get<DiscoveryRecord>(key);
  if (
    existing &&
    (sourceSnapshotVersion === undefined ||
      existing.sourceSnapshotVersion === sourceSnapshotVersion)
  ) {
    return existing.promise;
  }

  const discovery = {
    projectIdentity: ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir,
    sourceSnapshotVersion,
    promise: (async () => {
      const discoveryOptions = createProjectDiscoveryConfig({
        projectDir: ctx.projectDir,
        cacheNamespace: sourceSnapshotVersion === undefined
          ? key
          : `${key}:snapshot:${sourceSnapshotVersion}`,
        config: ctx.config,
        fsAdapter: ctx.adapter.fs,
      });
      const shouldWarnOnEmptyAiDiscovery = discoveryOptions.toolDirs.length > 0 ||
        discoveryOptions.agentDirs.length > 0;

      const result = await replaceDiscoveredProjectPrimitives(discoveryOptions);
      const logData = {
        projectSlug: ctx.projectSlug,
        releaseId: ctx.releaseId,
        agents: result.agents.size,
        tools: result.tools.size,
        errors: 0,
      };

      if (
        result.agents.size === 0 && result.tools.size === 0 && shouldWarnOnEmptyAiDiscovery
      ) {
        logger.debug("Primitive discovery found 0 agents and 0 tools", logData);
      } else {
        logger.debug("Primitive discovery completed", logData);
      }

      return result;
    })(),
  };

  discoveredProjects.set(key, discovery);

  try {
    return await discovery.promise;
  } catch (error) {
    // A superseded generation may already own this key. Delete only our own
    // record so the newer discovery remains reusable after it completes.
    const current = discoveredProjects.get<DiscoveryRecord>(key);
    if (current === discovery) {
      discoveredProjects.delete(key);
    }
    const generationFailure = snapshotDiscoveryGenerationFailure(error, ctx.projectDir);
    if (generationFailure) {
      logger.warn("Primitive discovery rejected; retaining previous generation", {
        projectSlug: ctx.projectSlug,
        releaseId: ctx.releaseId,
        ...generationFailure,
      });
    } else {
      logRetryableDiscoveryFailure(ctx, error);
    }
    throw createRuntimeDiscoveryError(error);
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
  clearProjectRegistryScopes(projectId);
  for (const key of discoveredProjects.keys()) {
    const record = discoveredProjects.get<DiscoveryRecord>(key);
    if (
      record?.projectIdentity === projectId ||
      isRegistryScopeForProject(key, projectId)
    ) {
      discoveredProjects.delete(key);
    }
  }
}
