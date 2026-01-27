import { serverLogger as logger } from "#veryfront/utils";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { clearModuleCacheForProject } from "#veryfront/cache/module-cache.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { clearRendererCacheForProject } from "../../rendering/renderer.ts";
import { clearRouterDetectionCache } from "../../rendering/router-detection.ts";
import { clearSnippetCacheForProject } from "../../rendering/snippet-renderer.ts";
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
  const projectId = options?.projectId;
  const hasRealProjectSlug = projectSlug !== "preview" || !!projectId;
  const environment = options?.environment;

  logger.debug("[CacheInvalidation] ▶ Starting cache invalidation", {
    projectSlug,
    environment: environment ?? "all",
    changedPaths: changedPaths?.length ?? "all",
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

  logger.debug("[CacheInvalidation] Clearing SSR module cache", {
    projectSlug,
    projectId,
    mode: projectId ? "per-project" : "global",
  });
  if (projectId) {
    clearSSRModuleCacheForProject(projectId);
    // Also clear the pod-level module cache (used by RenderPipeline)
    // This was previously missed, causing stale renders despite SSR module cache clearing
    clearModuleCacheForProject(projectId);
  } else {
    clearSSRModuleCache();
  }

  logger.debug("[CacheInvalidation] Clearing router detection cache", { projectSlug });
  clearRouterDetectionCache();

  if (!hasRealProjectSlug) {
    logger.error(
      "[CacheInvalidation] Skipping cache invalidation — no project identity available",
      {
        projectSlug,
        reason: "projectSlug is 'preview' and no projectId provided",
        action: "skipped_global_wipe",
      },
    );
    // Previously called clearRendererCaches() which wiped ALL projects' caches on this pod.
    // This was a multi-tenant blast radius risk: one preview deployment could nuke every tenant's cache.
    // Now we skip the invalidation entirely. The stale cache will be naturally evicted by TTL
    // or the next scoped invalidation that includes a projectId.
    return;
  }

  const rendererProjectKey = projectId ?? projectSlug;
  logger.debug("[CacheInvalidation] Clearing renderer cache (per-project)", {
    projectSlug,
    projectId,
    rendererProjectKey,
  });
  await clearRendererCacheForProject(rendererProjectKey);

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

  if (projectId && options?.branchId) {
    logger.debug("[CacheInvalidation] Clearing registry caches (content-source)", {
      projectId,
      contentSourceId: options.branchId,
    });
    const deleted = cacheRegistry.deleteKeysForContentSource(projectId, options.branchId);
    logger.debug("[CacheInvalidation] Registry caches cleared (content-source)", {
      projectId,
      contentSourceId: options.branchId,
      keysDeleted: deleted,
    });
  }

  logger.debug("[CacheInvalidation] ✓ Per-project cache invalidation complete", {
    projectSlug,
    durationMs: Date.now() - startTime,
  });
}
