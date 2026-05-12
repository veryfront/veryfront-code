import { serverLogger } from "#veryfront/utils";
import { clearTrackedAgents, createProjectDiscoveryConfig } from "#veryfront/discovery";
import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
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
const discoveredProjects = new Map<string, Promise<void>>();

/** Build a discovery cache key that incorporates the release/version. */
function discoveryKey(ctx: HandlerContext): string {
  const cacheContext = tryGetCacheKeyContext();
  if (cacheContext) {
    return `${cacheContext.projectId}:${cacheContext.mode}:${cacheContext.versionId}`;
  }

  const slug = ctx.projectSlug ?? ctx.projectDir;
  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.releaseId ? "production" : "preview");

  if (environment === "production") {
    return `${slug}:release:${ctx.releaseId ?? "unknown"}`;
  }

  const branch = ctx.requestContext?.branch ?? ctx.enriched?.branch ?? ctx.parsedDomain?.branch ??
    "main";
  return `${slug}:preview:${branch}`;
}

function shouldCacheCompletedDiscovery(ctx: HandlerContext): boolean {
  const cacheContext = tryGetCacheKeyContext();
  if (cacheContext) {
    return cacheContext.mode === "production";
  }

  const environment = ctx.enriched?.environment ?? ctx.resolvedEnvironment ??
    (ctx.releaseId ? "production" : "preview");
  return environment === "production";
}

/**
 * Run primitive discovery (agents, tools) for a project if not already done.
 * Must be called within a runWithContext scope so the VFS can resolve
 * the correct remote project files and the agent registry uses the
 * correct project scope.
 */
export async function ensureProjectDiscovery(ctx: HandlerContext): Promise<void> {
  const key = discoveryKey(ctx);
  const cacheCompletedDiscovery = shouldCacheCompletedDiscovery(ctx);

  const existing = discoveredProjects.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { clearTranspileCache, discoverAll } = await import("#veryfront/discovery");
    const { agentRegistry } = await import(
      "#veryfront/agent/composition/composition.ts"
    );
    const { toolRegistry } = await import("#veryfront/tool/registry.ts");

    // Clear stale entries for this project scope before re-discovery.
    // This prevents agents/tools removed in a new release from lingering.
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

    if (
      result.agents.size === 0 && result.tools.size === 0 && shouldWarnOnEmptyAiDiscovery
    ) {
      logger.info("Primitive discovery found 0 agents and 0 tools", {
        ...logData,
        errorMessages: result.errors.map((e) => e.error.message).slice(0, 5),
        baseDir: ctx.projectDir,
      });
    } else {
      logger.info("Primitive discovery completed", logData);
    }
  })();

  discoveredProjects.set(key, promise);

  try {
    await promise;
  } catch (error) {
    // Allow retry on next request
    discoveredProjects.delete(key);
    logger.warn("Primitive discovery failed (will retry)", {
      projectSlug: ctx.projectSlug,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    if (!cacheCompletedDiscovery) {
      const current = discoveredProjects.get(key);
      if (current === promise) {
        discoveredProjects.delete(key);
      }
    }
  }
}
