import { serverLogger } from "#veryfront/utils";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { clearModuleCacheForProject } from "#veryfront/cache/module-cache.ts";
import {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
} from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { cacheRegistry } from "#veryfront/cache";
import { clearRendererCacheForProject } from "#veryfront/rendering/renderer.ts";
import {
  clearRouterDetectionCache,
  clearRouterDetectionCacheForProject,
} from "#veryfront/rendering/router-detection.ts";
import { clearSnippetCacheForProject } from "#veryfront/rendering/snippet-renderer.ts";
import { resetApiHandlerForProject } from "#veryfront/server/handlers/request/api/pages-api-handler.ts";

const logger = serverLogger.component("cache-invalidation");

interface InvalidationOptions {
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
  const environment = options?.environment;
  const hasRealProjectSlug = projectSlug !== "preview" || !!projectId;

  logger.debug("▶ Starting cache invalidation", {
    projectSlug,
    environment: environment ?? "all",
    changedPaths: changedPaths?.length ?? "all",
    mode: hasRealProjectSlug ? "per-project" : "global",
  });

  if (changedPaths?.length) {
    logger.debug("Clearing module paths (selective)", {
      projectSlug,
      pathCount: changedPaths.length,
    });
    invalidateModulePaths(changedPaths);
  } else {
    logger.debug("Clearing module path cache (full)", { projectSlug });
    clearModulePathCache();
  }

  logger.debug("Clearing SSR module cache", {
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

  logger.debug("Clearing router detection cache", { projectSlug, projectId });
  if (projectId) {
    clearRouterDetectionCacheForProject(projectId);
  } else {
    clearRouterDetectionCache();
  }

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

  logger.debug("Clearing renderer cache (per-project)", {
    projectSlug,
    projectId,
    rendererProjectKey,
  });
  await clearRendererCacheForProject(rendererProjectKey);

  logger.debug("Clearing snippet cache (per-project)", { projectSlug });
  clearSnippetCacheForProject(projectSlug);

  logger.debug("Clearing API route handler cache (per-project)", { projectSlug });
  try {
    await resetApiHandlerForProject(projectSlug);
  } catch (error) {
    logger.error("Failed to reset API route handler cache", { projectSlug, error });
  }

  if (projectId) {
    if (environment) {
      logger.debug("Clearing registry caches (environment-scoped)", {
        projectId,
        environment,
      });
      const deleted = cacheRegistry.deleteKeysForProjectEnvironment(projectId, environment);
      logger.debug("Registry caches cleared", {
        projectId,
        environment,
        keysDeleted: deleted,
      });
    }

    const branchId = options?.branchId;
    if (branchId) {
      logger.debug("Clearing registry caches (content-source)", {
        projectId,
        contentSourceId: branchId,
      });
      const deleted = cacheRegistry.deleteKeysForContentSource(projectId, branchId);
      logger.debug("Registry caches cleared (content-source)", {
        projectId,
        contentSourceId: branchId,
        keysDeleted: deleted,
      });
    }
  }

  logger.debug("✓ Per-project cache invalidation complete", {
    projectSlug,
    durationMs: Date.now() - startTime,
  });
}
