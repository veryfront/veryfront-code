/**
 * Memory Pressure Management
 *
 * Monitors heap usage and triggers eviction when memory is constrained.
 *
 * @module server/shared/renderer/memory/pressure
 */

import { rendererLogger } from "@veryfront/utils";
import { getHeapStats } from "@veryfront/core/memory/index.ts";
import { clearSSRModuleCacheForProject } from "@veryfront/module-system/react-loader/ssr-module-loader/index.ts";
import { MEMORY_PRESSURE_CRITICAL, MEMORY_PRESSURE_WARNING } from "../constants.ts";
import { rendererCache, setSingleProjectRenderer, singleProjectRenderer } from "../state.ts";
import { destroyRenderer } from "../lifecycle/cleanup.ts";
import { evictLRU } from "../cache/lru-cache.ts";

/**
 * Check memory pressure and evict renderers if needed.
 * This is called before creating new renderers and periodically in the background.
 *
 * @param source - Where the check was triggered from (for logging)
 * @returns Whether any eviction occurred
 */
export async function checkAndEvictUnderMemoryPressure(
  source: "pre-creation" | "periodic" | "manual" = "pre-creation",
): Promise<boolean> {
  const heap = getHeapStats();
  const { heapUsedPercent: usedPercent } = heap;
  const { size: cacheSize } = rendererCache;
  const hasSingleProject = !!singleProjectRenderer;

  // Always log the check with current state
  rendererLogger.info("[RendererFactory] Memory pressure check", {
    source,
    heapUsedMB: heap.usedHeapSizeMB,
    heapLimitMB: heap.heapSizeLimitMB,
    heapUsedPercent: usedPercent,
    rssMB: heap.rss,
    rendererCacheSize: cacheSize,
    hasSingleProject,
    thresholds: {
      warning: MEMORY_PRESSURE_WARNING,
      critical: MEMORY_PRESSURE_CRITICAL,
    },
  });

  if (usedPercent >= MEMORY_PRESSURE_CRITICAL) {
    // Critical: keep only 2 most recent renderers
    const targetSize = 2;
    rendererLogger.warn("[RendererFactory] CRITICAL memory pressure - emergency eviction", {
      source,
      heapUsedPercent: usedPercent,
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      currentSize: cacheSize,
      targetSize,
      action: "evicting all but 2 renderers",
    });
    await evictLRU(targetSize);

    // Also clear single project renderer if we have one and cache is still too big
    if (singleProjectRenderer && rendererCache.size >= targetSize) {
      rendererLogger.warn(
        "[RendererFactory] Evicting single-project renderer due to critical pressure",
      );
      await destroyRenderer(singleProjectRenderer);
      setSingleProjectRenderer(null);
    }

    // Log post-eviction state
    const postHeap = getHeapStats();
    rendererLogger.info("[RendererFactory] Post-eviction state", {
      source,
      heapUsedMB: postHeap.usedHeapSizeMB,
      heapUsedPercent: postHeap.heapUsedPercent,
      rendererCacheSize: rendererCache.size,
    });

    return true;
  } else if (usedPercent >= MEMORY_PRESSURE_WARNING) {
    // Warning: evict 50% of cache
    const targetSize = Math.max(2, Math.floor(cacheSize / 2));
    rendererLogger.warn("[RendererFactory] High memory pressure - evicting half of cache", {
      source,
      heapUsedPercent: usedPercent,
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      currentSize: cacheSize,
      targetSize,
      action: "evicting 50% of renderers",
    });
    await evictLRU(targetSize);

    // Log post-eviction state
    const postHeap = getHeapStats();
    rendererLogger.info("[RendererFactory] Post-eviction state", {
      source,
      heapUsedMB: postHeap.usedHeapSizeMB,
      heapUsedPercent: postHeap.heapUsedPercent,
      rendererCacheSize: rendererCache.size,
    });

    return true;
  }

  // Memory is OK
  rendererLogger.debug("[RendererFactory] Memory pressure OK", {
    source,
    heapUsedPercent: usedPercent,
    rendererCacheSize: cacheSize,
  });

  return false;
}

/**
 * Check if memory is too high to safely process a request.
 * Returns true if the request should be rejected to prevent OOM.
 *
 * This is a fast, synchronous check that should be called before starting
 * expensive SSR operations.
 */
export function shouldRejectDueToMemory(): boolean {
  const heap = getHeapStats();
  // Reject if we're above 90% of heap limit - OOM is imminent
  if (heap.heapUsedPercent >= 90) {
    rendererLogger.warn("[RendererFactory] Rejecting request - memory critical", {
      heapUsedMB: heap.usedHeapSizeMB,
      heapLimitMB: heap.heapSizeLimitMB,
      heapUsedPercent: heap.heapUsedPercent,
    });
    return true;
  }
  return false;
}

/**
 * Aggressively clear caches for a specific project after SSR render.
 * This should be called after every SSR render to prevent memory buildup
 * from large projects like codersociety.
 *
 * @param projectSlug - Project slug to clear caches for
 * @param projectId - Project ID for SSR module cache
 */
export async function clearProjectCachesAfterRender(
  projectSlug: string,
  projectId?: string,
): Promise<void> {
  const heap = getHeapStats();

  // Only do aggressive eviction if memory is elevated (>50% of heap)
  if (heap.heapUsedPercent < 50) {
    return;
  }

  rendererLogger.info("[RendererFactory] Post-render cache eviction", {
    projectSlug,
    projectId,
    heapUsedMB: heap.usedHeapSizeMB,
    heapUsedPercent: heap.heapUsedPercent,
  });

  // Clear SSR module cache for this project
  if (projectId) {
    clearSSRModuleCacheForProject(projectId);
  } else if (projectSlug) {
    clearSSRModuleCacheForProject(projectSlug);
  }

  // If memory is very high, also trigger broader eviction
  if (heap.heapUsedPercent >= 70) {
    await checkAndEvictUnderMemoryPressure("manual");
  }
}
