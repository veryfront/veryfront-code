/**
 * Distributed Cache for SSR Modules
 *
 * Redis caching for cross-pod module sharing.
 *
 * @module module-system/react-loader/ssr-module-loader/cache/redis
 */

import { rendererLogger as logger } from "#veryfront/utils";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import { buildRedisSSRModuleKey } from "#veryfront/cache";
import { getSSRModuleRedisTTL, REDIS_TTL_SECONDS } from "../constants.ts";

let redisEnabled = false;
let redisClient: RedisClient | null = null;
let redisInitialized = false;
let redisInitPromise: Promise<void> | null = null;

/**
 * Generate a Redis key with the standard prefix.
 * Re-exported for backward compatibility.
 */
export function redisKey(key: string): string {
  return buildRedisSSRModuleKey(key);
}

/**
 * Initialize distributed caching for SSR modules.
 * Call this at startup if you want to enable cross-pod cache sharing.
 */
export async function initializeSSRDistributedCache(): Promise<boolean> {
  if (redisInitialized) return redisEnabled;

  if (redisInitPromise) {
    await redisInitPromise;
    return redisEnabled;
  }

  redisInitPromise = (async () => {
    if (!isRedisConfigured()) {
      logger.debug("[SSR-MODULE-LOADER] Redis not configured, using memory cache");
      redisInitialized = true;
      return;
    }

    try {
      redisClient = await getRedisClient();
      redisEnabled = true;
      logger.debug("[SSR-MODULE-LOADER] Redis cache enabled");
    } catch (error) {
      logger.warn("[SSR-MODULE-LOADER] Redis unavailable, falling back to memory cache", { error });
      redisEnabled = false;
    } finally {
      redisInitialized = true;
    }
  })();

  await redisInitPromise;
  redisInitPromise = null;

  return redisEnabled;
}

/**
 * Check if distributed caching is enabled for SSR modules.
 */
export function isSSRDistributedCacheEnabled(): boolean {
  return redisEnabled && redisClient !== null;
}

/** @deprecated Use initializeSSRDistributedCache instead */
export const initializeSSRRedisCache = initializeSSRDistributedCache;

/** @deprecated Use isSSRDistributedCacheEnabled instead */
export const isSSRRedisCacheEnabled = isSSRDistributedCacheEnabled;

/**
 * Get the current Redis enabled state.
 */
export function getRedisEnabled(): boolean {
  return redisEnabled;
}

/**
 * Get the current Redis client (may be null).
 */
export function getRedisClientInstance(): RedisClient | null {
  return redisClient;
}

/**
 * Get transformed code from Redis.
 */
export async function getFromRedis(cacheKey: string): Promise<string | null> {
  if (!redisEnabled || !redisClient) return null;

  try {
    return await redisClient.get(redisKey(cacheKey));
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Redis get failed", { key: cacheKey, error });
    return null;
  }
}

/**
 * Store transformed code in Redis.
 *
 * @param cacheKey The cache key
 * @param code The transformed code
 * @param options Optional settings
 * @param options.isProduction Whether this is production mode (affects TTL)
 * @param options.ttlSeconds Override TTL in seconds
 */
export async function setInRedis(
  cacheKey: string,
  code: string,
  options?: { isProduction?: boolean; ttlSeconds?: number },
): Promise<void> {
  if (!redisEnabled || !redisClient) return;

  const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);

  try {
    await redisClient.set(redisKey(cacheKey), code, { EX: ttl });
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Redis set failed", { key: cacheKey, error });
  }
}
