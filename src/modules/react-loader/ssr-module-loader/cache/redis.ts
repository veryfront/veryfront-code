/** Redis caching for cross-pod SSR module sharing */

import { rendererLogger as logger } from "#veryfront/utils";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "#veryfront/utils/redis-client.ts";
import { buildRedisSSRModuleKey } from "#veryfront/cache";
import { getSSRModuleRedisTTL } from "../constants.ts";

let redisEnabled = false;
let redisClient: RedisClient | null = null;
let redisInitialized = false;
let redisInitPromise: Promise<void> | null = null;

export function redisKey(key: string): string {
  return buildRedisSSRModuleKey(key);
}

/** Initialize distributed caching for SSR modules */
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

export function isSSRDistributedCacheEnabled(): boolean {
  return redisEnabled && redisClient !== null;
}

/** @deprecated Use initializeSSRDistributedCache instead */
export const initializeSSRRedisCache = initializeSSRDistributedCache;

/** @deprecated Use isSSRDistributedCacheEnabled instead */
export const isSSRRedisCacheEnabled = isSSRDistributedCacheEnabled;

export function getRedisEnabled(): boolean {
  return redisEnabled;
}

export function getRedisClientInstance(): RedisClient | null {
  return redisClient;
}

export async function getFromRedis(cacheKey: string): Promise<string | null> {
  if (!redisEnabled || !redisClient) return null;

  try {
    return await redisClient.get(redisKey(cacheKey));
  } catch (error) {
    logger.debug("[SSR-MODULE-LOADER] Redis get failed", { key: cacheKey, error });
    return null;
  }
}

/** Store transformed code in Redis with environment-aware TTL */
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
