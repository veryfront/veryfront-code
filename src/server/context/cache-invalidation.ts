/**
 * Cache Invalidation
 *
 * Provides a unified interface for invalidating all project caches.
 * Used by Preview HMR to ensure fresh content after file changes.
 *
 * NOTE: This module uses GLOBAL cache clearing functions. For multi-tenant
 * deployments, prefer per-project clearing via the FSAdapter's invalidation
 * callbacks which have access to projectId and projectDir.
 *
 * @module server/context/cache-invalidation
 */

import { serverLogger as logger } from "#veryfront/utils";
import {
  clearModulePathCache,
  invalidateModulePaths,
} from "#veryfront/transforms/mdx/esm-module-loader/index.ts";
import { clearSSRModuleCache } from "#veryfront/modules/react-loader/ssr-module-loader/index.ts";
import { clearRendererCaches } from "../../rendering/renderer.ts";
import { clearRouterDetectionCache } from "../../rendering/router-detection.ts";
import { clearSnippetCache } from "../../rendering/snippet-renderer.ts";

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
 * NOTE: This function uses GLOBAL cache clearing. In multi-tenant deployments,
 * this clears caches for ALL projects. For per-project clearing, use the
 * FSAdapter's invalidation callbacks which have projectId context.
 *
 * @param projectSlug - Project slug (used for logging only)
 * @param changedPaths - Array of changed file paths (for selective invalidation)
 */
export function invalidateProjectCaches(
  projectSlug: string,
  changedPaths?: string[],
): void {
  const startTime = Date.now();

  logger.debug("[CacheInvalidation] Starting cache invalidation", {
    projectSlug,
    changedPaths: changedPaths?.length ?? "all",
  });

  // Selective invalidation for specific changed files (faster)
  if (changedPaths && changedPaths.length > 0) {
    invalidateModulePaths(changedPaths);
  } else {
    // Full cache clear
    clearModulePathCache();
  }

  // Always clear these caches on any file change
  clearSSRModuleCache();
  clearRendererCaches();
  clearRouterDetectionCache();
  clearSnippetCache();

  const durationMs = Date.now() - startTime;
  logger.debug("[CacheInvalidation] Cache invalidation complete", {
    projectSlug,
    durationMs,
    changedPaths: changedPaths?.length ?? "all",
  });
}

/**
 * Clear all project caches (full invalidation).
 *
 * Use this when you need to ensure everything is fresh,
 * such as after a deployment or major content update.
 *
 * @param projectSlug - Project slug (used for logging)
 */
export function clearAllProjectCaches(projectSlug: string): void {
  invalidateProjectCaches(projectSlug);
}
