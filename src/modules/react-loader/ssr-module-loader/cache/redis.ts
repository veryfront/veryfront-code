/**
 * SSR Module Cache
 *
 * Local-only LRU caching for SSR modules. JIT bundling handles production mode,
 * and preview typically runs on a single pod.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";

/** In-memory LRU cache for SSR modules */
const ssrModuleCache = new LRUCache<string, string>({ maxEntries: 2000 });

/** Initialize SSR module cache */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  return true;
}

/** Check if SSR caching is enabled */
export function isSSRDistributedCacheEnabled(): boolean {
  return true;
}

/** Get code from cache */
export async function getFromRedis(cacheKey: string): Promise<string | null> {
  const cached = ssrModuleCache.get(cacheKey);
  if (cached) {
    logger.debug("[SSR-MODULE-CACHE] Cache hit", { key: cacheKey.slice(-40) });
    return cached;
  }
  return null;
}

/** Store transformed code in cache */
export async function setInRedis(
  cacheKey: string,
  code: string,
  _options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  ssrModuleCache.set(cacheKey, code);
  logger.debug("[SSR-MODULE-CACHE] Cached", { key: cacheKey.slice(-40) });
}

/** Clear the SSR module cache */
export function clearSSRModuleCache(): void {
  ssrModuleCache.clear();
}
