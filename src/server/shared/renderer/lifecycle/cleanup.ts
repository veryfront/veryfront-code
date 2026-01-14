/**
 * Renderer Cleanup
 *
 * Handles destruction of renderer instances and cache cleanup.
 *
 * @module server/shared/renderer/lifecycle/cleanup
 */

import { rendererLogger } from "@veryfront/utils";
import { clearSSRModuleCacheForProject } from "@veryfront/module-system/react-loader/ssr-module-loader/index.ts";
import type { CachedRenderer } from "../types.ts";
import {
  inFlightCreations,
  memoryCheckInterval,
  rendererCache,
  setMemoryCheckInterval,
  setSingleProjectRenderer,
  singleProjectRenderer,
} from "../state.ts";

/**
 * Clean up a renderer instance and its associated caches.
 */
export async function destroyRenderer(cached: CachedRenderer): Promise<void> {
  const { renderer, projectSlug } = cached;

  rendererLogger.debug("[RendererFactory] Destroying renderer", {
    projectSlug,
    age: Math.round((Date.now() - cached.createdAt) / 1000),
  });

  try {
    // Clear all state from the renderer
    renderer.clearAllState?.();

    // Destroy the renderer (clears internal caches)
    await renderer.destroy?.();

    // Clear SSR module cache for this project to prevent memory growth
    if (projectSlug && projectSlug !== "__single__") {
      clearSSRModuleCacheForProject(projectSlug);
    }
  } catch (error) {
    rendererLogger.warn("[RendererFactory] Error destroying renderer", {
      projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Cleanup all cached renderer instances.
 *
 * Destroys all renderer instances that were created, cleaning up
 * their internal resources (cache stores, intervals, etc.).
 * Should be called during test cleanup or server shutdown.
 */
export async function cleanupRenderers(): Promise<void> {
  rendererLogger.info("[RendererFactory] Cleaning up all renderers", {
    cacheSize: rendererCache.size,
    hasSingleProject: !!singleProjectRenderer,
    hasPeriodicCheck: !!memoryCheckInterval,
  });

  // Stop periodic memory check first
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    setMemoryCheckInterval(null);
  }

  // Clean up all cached renderers
  for (const [_key, cached] of rendererCache) {
    await destroyRenderer(cached);
  }
  rendererCache.clear();

  // Clean up single-project renderer
  if (singleProjectRenderer) {
    await destroyRenderer(singleProjectRenderer);
    setSingleProjectRenderer(null);
  }

  // Clear in-flight creations
  inFlightCreations.clear();

  rendererLogger.info("[RendererFactory] Renderer cleanup complete");
}

/**
 * Evict all renderers for a specific project from cache.
 * This evicts both preview and production (all releases) entries.
 *
 * @param projectSlug - Project slug to evict
 */
export async function evictProjectRenderer(projectSlug: string): Promise<void> {
  const prefix = `${projectSlug}:`;
  const toEvict: string[] = [];

  // Find all cache keys that belong to this project
  for (const key of rendererCache.keys()) {
    if (key.startsWith(prefix)) {
      toEvict.push(key);
    }
  }

  // Evict all matching entries
  for (const key of toEvict) {
    const cached = rendererCache.get(key);
    if (cached) {
      rendererCache.delete(key);
      await destroyRenderer(cached);
    }
  }

  if (toEvict.length > 0) {
    rendererLogger.debug("[RendererFactory] Evicted project renderers", {
      projectSlug,
      count: toEvict.length,
    });
  }
}
