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

export function invalidateProjectCaches(
  projectSlug: string,
  changedPaths?: string[],
): void {
  const startTime = Date.now();
  const hasRealProjectSlug = projectSlug !== "preview";

  logger.info("[CacheInvalidation] ▶ Starting cache invalidation", {
    projectSlug,
    hasRealProjectSlug,
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
    clearRendererCaches();
    clearSnippetCache();
    logger.info("[CacheInvalidation] ✓ Global cache invalidation complete", {
      projectSlug,
      durationMs: Date.now() - startTime,
      changedPaths: changedPaths?.length ?? "all",
    });
    return;
  }

  logger.debug("[CacheInvalidation] Clearing renderer cache (per-project)", { projectSlug });
  clearRendererCacheForProject(projectSlug);

  logger.debug("[CacheInvalidation] Clearing snippet cache (per-project)", { projectSlug });
  clearSnippetCacheForProject(projectSlug);

  logger.info("[CacheInvalidation] ✓ Per-project cache invalidation complete", {
    projectSlug,
    durationMs: Date.now() - startTime,
    changedPaths: changedPaths?.length ?? "all",
  });
}
