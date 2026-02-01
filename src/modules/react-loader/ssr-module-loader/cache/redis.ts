/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger as logger } from "#veryfront/utils";
import { type RedisClient } from "#veryfront/utils/redis-client.ts";
import { buildRedisSSRModuleKey } from "#veryfront/cache";
import { getSSRModuleRedisTTL } from "../constants.ts";
import { CacheBackends, createDistributedCodeCacheAccessor } from "#veryfront/cache/backend.ts";

/**
 * Lazy-loaded distributed cache gateway for cross-pod sharing.
 * Uses TokenizingCacheGateway to automatically handle tokenization/detokenization.
 */
const getDistributedCodeCache = createDistributedCodeCacheAccessor(
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
  return (await getDistributedCodeCache()) !== null;
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

/**
 * Get code from distributed cache with automatic detokenization.
 * The TokenizingCacheGateway handles replacing __VF_CACHE_DIR__ tokens with local paths.
 */
export async function getFromRedis(cacheKey: string): Promise<string | null> {
  const gateway = await getDistributedCodeCache();
  if (!gateway) return null;

  try {
    // Use getCode() for automatic detokenization
    return await gateway.getCode(cacheKey);
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Distributed cache get failed", { key: cacheKey, error });
    return null;
  }
}

/**
 * Store transformed code in distributed cache with automatic tokenization.
 * The TokenizingCacheGateway handles replacing absolute file:// paths with __VF_CACHE_DIR__ tokens.
 */
export async function setInRedis(
  cacheKey: string,
  code: string,
  options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  const gateway = await getDistributedCodeCache();
  if (!gateway) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);

  try {
    // Use setCode() for automatic tokenization
    await gateway.setCode(cacheKey, code, ttl);
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Distributed cache set failed", { key: cacheKey, error });
  }
}
