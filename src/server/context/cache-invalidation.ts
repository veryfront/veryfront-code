import { serverLogger as logger } from "#veryfront/utils";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { clearSSRModuleCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { clearRendererCacheForProject, clearRendererCaches } from "../../rendering/renderer.ts";
import { clearRouterDetectionCache } from "../../rendering/router-detection.ts";
import {
  clearSnippetCache,
  clearSnippetCacheForProject,
} from "../../rendering/snippet-renderer.ts";
import { cacheRegistry } from "#veryfront/cache";

export interface InvalidationOptions {
  /** Environment scope: only invalidate caches for this environment */
  environment?: "production" | "preview";
  /** Branch ID for preview mode scoping */
  branchId?: string | null;
  /** Project ID for registry-based invalidation */
  projectId?: string;
}

/**
 * Invalidate project caches with optional environment scoping.
 * When environment is specified, only caches for that environment are invalidated.
 */
export async function invalidateProjectCaches(
  projectSlug: string,
  changedPaths?: string[],
  options?: InvalidationOptions,
): Promise<void> {
  const startTime = Date.now();
  const hasRealProjectSlug = projectSlug !== "preview";
  const environment = options?.environment;
  const projectId = options?.projectId;

  logger.info("[CacheInvalidation] ▶ Starting cache invalidation", {
    projectSlug,
    hasRealProjectSlug,
    environment: environment ?? "all",
    changedPaths: changedPaths?.length ?? "all",
    changedFiles: changedPaths?.slice(0, 5),
    mode: hasRealProjectSlug ? "per-project" : "global",
  });

  if (changedPaths?.length) {
    logger.debug("[CacheInvalidation] Clearing module paths (selective)", {
      projectSlug,
      pathCount: changedPaths.length,
    });
    invalidateModulePaths(changedPaths);
  } else {
    logger.debug("[CacheInvalidation] Clearing module path cache (full)", { projectSlug });
    clearModulePathCache();
  }

  logger.debug("[CacheInvalidation] Clearing SSR module cache", { projectSlug });
  clearSSRModuleCache();

  logger.debug("[CacheInvalidation] Clearing router detection cache", { projectSlug });
  clearRouterDetectionCache();

  if (!hasRealProjectSlug) {
    logger.warn("[CacheInvalidation] Using GLOBAL cache clearing (no project slug)", {
      projectSlug,
      reason: "projectSlug is 'preview' or undefined",
    });
    await clearRendererCaches();
    clearSnippetCache();
    logger.info("[CacheInvalidation] ✓ Global cache invalidation complete", {
      projectSlug,
      durationMs: Date.now() - startTime,
      changedPaths: changedPaths?.length ?? "all",
    });
    return;
  }

  logger.debug("[CacheInvalidation] Clearing renderer cache (per-project)", { projectSlug });
  await clearRendererCacheForProject(projectSlug);

  logger.debug("[CacheInvalidation] Clearing snippet cache (per-project)", { projectSlug });
  clearSnippetCacheForProject(projectSlug);

  // Environment-scoped registry invalidation (memory + Redis)
  if (projectId && environment) {
    logger.debug("[CacheInvalidation] Clearing registry caches (environment-scoped)", {
      projectId,
      environment,
    });
    const deleted = cacheRegistry.deleteKeysForProjectEnvironment(projectId, environment);
    logger.debug("[CacheInvalidation] Registry caches cleared", {
      projectId,
      environment,
      keysDeleted: deleted,
    });
  }

  logger.info("[CacheInvalidation] ✓ Per-project cache invalidation complete", {
    projectSlug,
    environment: environment ?? "all",
    durationMs: Date.now() - startTime,
    changedPaths: changedPaths?.length ?? "all",
  });
}
