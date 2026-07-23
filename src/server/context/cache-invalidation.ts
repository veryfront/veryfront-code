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
import { clearSourceMissCache } from "#veryfront/modules/server/module-source-resolution-cache.ts";
import { invalidateProjectMiddlewareCache } from "#veryfront/server/runtime-handler/project-middleware.ts";

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

  logger.debug("Starting cache invalidation", {
    environment: environment ?? "all",
    changedPathCount: changedPaths?.length ?? 0,
    pathScope: changedPaths?.length ? "selective" : "all",
    projectScope: hasRealProjectSlug ? "project" : "unresolved",
  });

  if (changedPaths?.length) {
    logger.debug("Clearing module paths (selective)", {
      pathCount: changedPaths.length,
    });
    invalidateModulePaths(changedPaths);
  } else {
    logger.debug("Clearing module path cache (full)");
    clearModulePathCache();
  }
  clearSourceMissCache();

  const middlewareEntries = invalidateProjectMiddlewareCache(projectSlug, projectId);
  logger.debug("Clearing project middleware cache", {
    entriesDeleted: middlewareEntries,
  });

  logger.debug("Clearing SSR module cache", {
    cacheScope: projectId ? "project" : "global",
  });

  if (projectId) {
    clearSSRModuleCacheForProject(projectId);
    // Also clear the pod-level module cache (used by RenderPipeline)
    // This was previously missed, causing stale renders despite SSR module cache clearing
    clearModuleCacheForProject(projectId);
  } else {
    clearSSRModuleCache();
  }

  logger.debug("Clearing router detection cache", {
    cacheScope: projectId ? "project" : "global",
  });
  if (projectId) {
    clearRouterDetectionCacheForProject(projectId);
  } else {
    clearRouterDetectionCache();
  }

  if (!hasRealProjectSlug) {
    logger.error(
      "Skipping cache invalidation because project identity is unavailable",
      {
        reason: "missing-project-identity",
        action: "skip-global-invalidation",
      },
    );
    // Previously called clearRendererCaches() which wiped ALL projects' caches on this pod.
    // This was a multi-tenant blast radius risk: one preview deployment could nuke every tenant's cache.
    // Now we skip the invalidation entirely. The stale cache will be naturally evicted by TTL
    // or the next scoped invalidation that includes a projectId.
    return;
  }

  const rendererProjectKey = projectId ?? projectSlug;

  logger.debug("Clearing renderer cache", { cacheScope: "project" });
  await clearRendererCacheForProject(rendererProjectKey);

  logger.debug("Clearing snippet cache", { cacheScope: "project" });
  clearSnippetCacheForProject(projectSlug);

  logger.debug("Clearing API route handler cache", { cacheScope: "project" });
  try {
    await resetApiHandlerForProject(projectSlug);
  } catch (error) {
    logger.error("Failed to reset API route handler cache", {
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }

  if (projectId) {
    if (environment) {
      logger.debug("Clearing registry caches (environment-scoped)", {
        environment,
      });
      const deleted = cacheRegistry.deleteKeysForProjectEnvironment(projectId, environment);
      logger.debug("Registry caches cleared", {
        environment,
        keysDeleted: deleted,
      });
    }

    const branchId = options?.branchId;
    if (branchId) {
      logger.debug("Clearing registry caches (content-source)");
      const deleted = cacheRegistry.deleteKeysForContentSource(projectId, branchId);
      logger.debug("Registry caches cleared (content-source)", {
        keysDeleted: deleted,
      });
    }
  }

  logger.debug("Project cache invalidation complete", {
    durationMs: Date.now() - startTime,
  });
}
