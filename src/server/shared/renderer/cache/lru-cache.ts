/**
 * LRU Cache Management
 *
 * Eviction logic for the renderer cache based on LRU and TTL.
 *
 * @module server/shared/renderer/cache/lru-cache
 */

import { rendererLogger } from "@veryfront/utils";
import { MAX_RENDERER_CACHE_SIZE, RENDERER_TTL_MS } from "../constants.ts";
import { rendererCache } from "../state.ts";
import { destroyRenderer } from "../lifecycle/cleanup.ts";

/**
 * Evict least recently used renderers to maintain cache size.
 */
export async function evictLRU(targetSize: number = MAX_RENDERER_CACHE_SIZE - 1): Promise<void> {
  if (rendererCache.size <= targetSize) {
    return;
  }

  // Sort by last access time (oldest first)
  const entries = [...rendererCache.entries()]
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);

  const toEvict = entries.slice(0, rendererCache.size - targetSize);

  for (const [key, cached] of toEvict) {
    rendererCache.delete(key);
    await destroyRenderer(cached);
  }

  rendererLogger.info("[RendererFactory] LRU eviction complete", {
    evicted: toEvict.length,
    remaining: rendererCache.size,
  });
}

/**
 * Evict expired renderers based on TTL.
 */
export async function evictExpired(): Promise<void> {
  const now = Date.now();
  const expired: string[] = [];

  for (const [key, cached] of rendererCache) {
    if (now - cached.lastAccess > RENDERER_TTL_MS) {
      expired.push(key);
    }
  }

  for (const key of expired) {
    const cached = rendererCache.get(key);
    if (cached) {
      rendererCache.delete(key);
      await destroyRenderer(cached);
    }
  }

  if (expired.length > 0) {
    rendererLogger.info("[RendererFactory] Evicted expired renderers", {
      count: expired.length,
      remaining: rendererCache.size,
    });
  }
}
