/**
 * Redis Cache for SSR Modules
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
import { REDIS_TTL_SECONDS } from "../constants.ts";
import { buildRedisSSRModuleKey } from "#veryfront/cache";

// Redis state
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
 * Initialize Redis for SSR module cache.
 * Call this at startup if you want to enable Redis caching.
 */
export async function initializeSSRRedisCache(): Promise<boolean> {
  if (redisInitialized) {
    return redisEnabled;
  }

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
      redisInitialized = true;
      logger.debug("[SSR-MODULE-LOADER] Redis cache enabled");
    } catch (error) {
      logger.warn("[SSR-MODULE-LOADER] Redis unavailable, falling back to memory cache", { error });
      redisEnabled = false;
      redisInitialized = true;
    }
  })();

  await redisInitPromise;
  redisInitPromise = null;
  return redisEnabled;
}

/**
 * Check if Redis caching is enabled for SSR modules.
 */
export function isSSRRedisCacheEnabled(): boolean {
  return redisEnabled && redisClient !== null;
}

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
 */
export async function setInRedis(cacheKey: string, code: string): Promise<void> {
  if (!redisEnabled || !redisClient) return;

  try {
    await redisClient.set(redisKey(cacheKey), code, { EX: REDIS_TTL_SECONDS });
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Redis set failed", { key: cacheKey, error });
  }
}
