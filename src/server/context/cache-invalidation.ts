/**
 * Cache Invalidation
 *
 * Provides a unified interface for invalidating all project caches.
 * Used by Preview HMR to ensure fresh content after file changes.
 *
 * Supports both global clearing (legacy) and per-project clearing (preferred).
 * When projectSlug is provided, uses per-project clearing for better isolation
 * in multi-tenant deployments.
 *
 * @module server/context/cache-invalidation
 */

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

/**
 * Invalidate all caches for a project when files change.
 *
 * This is the main entry point for cache invalidation from:
 * - Preview HMR WebSocket handler (file change notifications)
 * - Studio poke mechanism
 * - Manual cache clear requests
 *
 * Invalidates:
 * - Module path cache (ESM resolution)
 * - SSR module cache (compiled modules)
 * - Renderer cache (HTML output)
 * - Router detection cache (app vs pages router)
 * - Snippet cache (MDX snippets)
 *
 * When projectSlug is provided (not generic "preview"), uses per-project
 * clearing for better isolation in multi-tenant deployments. This prevents
 * clearing other projects' caches unnecessarily.
 *
 * @param projectSlug - Project slug for per-project clearing, or "preview" for global clear
 * @param changedPaths - Array of changed file paths (for selective invalidation)
 */
export function invalidateProjectCaches(
  projectSlug: string,
  changedPaths?: string[],
): void {
  const startTime = Date.now();

  // Check if we have a real project slug (not generic "preview")
  const hasRealProjectSlug = projectSlug && projectSlug !== "preview";

  logger.info("[CacheInvalidation] ▶ Starting cache invalidation", {
    projectSlug,
    hasRealProjectSlug,
    changedPaths: changedPaths?.length ?? "all",
    changedFiles: changedPaths?.slice(0, 5), // Log first 5 paths
    mode: hasRealProjectSlug ? "per-project" : "global",
  });

  // Selective invalidation for specific changed files (faster)
  if (changedPaths && changedPaths.length > 0) {
    logger.debug("[CacheInvalidation] Clearing module paths (selective)", {
      projectSlug,
      pathCount: changedPaths.length,
    });
    invalidateModulePaths(changedPaths);
  } else {
    logger.debug("[CacheInvalidation] Clearing module path cache (full)", { projectSlug });
    clearModulePathCache();
  }

  // Clear SSR module cache (always global - modules may be shared)
  logger.debug("[CacheInvalidation] Clearing SSR module cache", { projectSlug });
  clearSSRModuleCache();

  // Clear router detection cache (always global)
  logger.debug("[CacheInvalidation] Clearing router detection cache", { projectSlug });
  clearRouterDetectionCache();

  // For render and snippet caches, use per-project clearing when available
  // This is critical for multi-tenant performance - avoids clearing other projects' caches
  if (hasRealProjectSlug) {
    // Per-project clearing (preferred for multi-tenant)
    logger.debug("[CacheInvalidation] Clearing renderer cache (per-project)", { projectSlug });
    clearRendererCacheForProject(projectSlug);
    logger.debug("[CacheInvalidation] Clearing snippet cache (per-project)", { projectSlug });
    clearSnippetCacheForProject(projectSlug);
    logger.info("[CacheInvalidation] ✓ Per-project cache invalidation complete", {
      projectSlug,
      durationMs: Date.now() - startTime,
      changedPaths: changedPaths?.length ?? "all",
    });
  } else {
    // Global clearing (fallback when no project context)
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
  }
}
