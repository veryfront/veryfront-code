/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger as logger } from "#veryfront/utils";
import { type RedisClient } from "#veryfront/utils/redis-client.ts";
import {
  buildRedisSSRModuleKey,
  detokenizeAllCachePaths,
  tokenizeAllVeryFrontPaths,
} from "#veryfront/cache";
import { getSSRModuleRedisTTL } from "../constants.ts";
import { CacheBackends, createDistributedCacheAccessor } from "#veryfront/cache/backend.ts";

/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(
  () => CacheBackends.ssrModule(),
  "SSR-MODULE-LOADER",
);

/**
 * @deprecated Legacy key builder. CacheBackend handles prefixing internally.
 * Used only for backward compatibility if needed.
 */
export function redisKey(key: string): string {
  return buildRedisSSRModuleKey(key);
}

/** Initialize distributed caching for SSR modules */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  return (await getDistributedCache()) !== null;
}

/** Check if distributed caching is enabled for SSR modules */
export function isSSRDistributedCacheEnabled(): boolean {
  return true;
}

/** @deprecated Use initializeSSRDistributedCache instead */
export const initializeSSRRedisCache = initializeSSRDistributedCache;

/** @deprecated Use isSSRDistributedCacheEnabled instead */
export const isSSRRedisCacheEnabled = isSSRDistributedCacheEnabled;

/** @deprecated Use isSSRDistributedCacheEnabled instead */
export function getRedisEnabled(): boolean {
  return isSSRDistributedCacheEnabled();
}

/**
 * @deprecated Direct Redis client access is deprecated. Use CacheBackend abstraction.
 * Returns null to force use of CacheBackend path in updated consumers.
 */
export function getRedisClientInstance(): RedisClient | null {
  return null;
}

export async function getFromRedis(cacheKey: string): Promise<string | null> {
  const backend = await getDistributedCache();
  if (!backend) return null;

  try {
    const cachedCode = await backend.get(cacheKey);
    if (!cachedCode) return null;

    // CRITICAL: Always detokenize after reading from distributed cache
    // This replaces __VF_CACHE_DIR__ tokens with local cache paths
    return detokenizeAllCachePaths(cachedCode);
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Distributed cache get failed", { key: cacheKey, error });
    return null;
  }
}

/** Store transformed code in Redis with environment-aware TTL */
export async function setInRedis(
  cacheKey: string,
  code: string,
  options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  const backend = await getDistributedCache();
  if (!backend) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);

  try {
    // CRITICAL: Always tokenize before storing in distributed cache
    // This replaces absolute file:// paths with __VF_CACHE_DIR__ tokens for cross-pod portability
    const portableCode = tokenizeAllVeryFrontPaths(code);
    await backend.set(cacheKey, portableCode, ttl);
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Distributed cache set failed", { key: cacheKey, error });
  }
}
