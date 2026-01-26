import { serverLogger as logger } from "../../utils/index.js";
import { clearModulePathCache, invalidateModulePaths, } from "../../transforms/mdx/esm-module-loader/index.js";
import { clearModuleCacheForProject } from "../../cache/module-cache.js";
import { clearSSRModuleCache, clearSSRModuleCacheForProject, } from "../../modules/react-loader/ssr-module-loader/index.js";
import { clearRendererCacheForProject, clearRendererCaches } from "../../rendering/renderer.js";
import { clearRouterDetectionCache } from "../../rendering/router-detection.js";
import { clearSnippetCache, clearSnippetCacheForProject, } from "../../rendering/snippet-renderer.js";
import { cacheRegistry } from "../../cache/index.js";
/**
 * Invalidate project caches with optional environment scoping.
 * When environment is specified, only caches for that environment are invalidated.
 */
export async function invalidateProjectCaches(projectSlug, changedPaths, options) {
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
    }
    else {
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
    }
    else {
        clearSSRModuleCache();
    }
    logger.debug("[CacheInvalidation] Clearing router detection cache", { projectSlug });
    clearRouterDetectionCache();
    if (!hasRealProjectSlug) {
        logger.warn("[CacheInvalidation] Using GLOBAL cache clearing (no project slug)", {
            projectSlug,
            reason: "projectSlug is 'preview' or undefined",
        });
        await clearRendererCaches();
        clearSnippetCache();
        logger.debug("[CacheInvalidation] ✓ Global cache invalidation complete", {
            projectSlug,
            durationMs: Date.now() - startTime,
        });
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
