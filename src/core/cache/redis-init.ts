/**
 * Redis Cache Initialization
 *
 * Initializes all Redis-enabled caches for cross-pod cache sharing.
 * This reduces memory pressure on individual pods by offloading
 * cached data to a shared Redis instance.
 *
 * Call this at server startup when REDIS_URL is configured.
 */

import { logger } from "../utils/logger/logger.ts";
import { initializeRedisCache } from "@veryfront/build/transforms/esm/transform-cache.ts";
import { initializeSSRRedisCache } from "@veryfront/modules/react-loader/ssr-module-loader.ts";
import { initializeFileCacheRedis } from "@veryfront/platform/adapters/fs/cache/file-cache.ts";
import { isRedisConfigured } from "../utils/redis-client.ts";

export interface RedisCacheStatus {
  configured: boolean;
  transformCache: boolean;
  ssrModuleCache: boolean;
  fileCache: boolean;
}

/**
 * Initialize all Redis caches.
 *
 * This function is idempotent and safe to call multiple times.
 * Each cache will only initialize Redis once.
 *
 * @returns Status object indicating which caches were enabled
 */
export async function initializeRedisCaches(): Promise<RedisCacheStatus> {
  const status: RedisCacheStatus = {
    configured: isRedisConfigured(),
    transformCache: false,
    ssrModuleCache: false,
    fileCache: false,
  };

  if (!status.configured) {
    logger.debug("[Redis] Not configured (REDIS_URL not set), using memory-only caches");
    return status;
  }

  logger.info("[Redis] Initializing Redis caches...");

  // Initialize all caches in parallel
  const [transformResult, ssrResult, fileResult] = await Promise.allSettled([
    initializeRedisCache(),
    initializeSSRRedisCache(),
    initializeFileCacheRedis(),
  ]);

  status.transformCache = transformResult.status === "fulfilled" && transformResult.value;
  status.ssrModuleCache = ssrResult.status === "fulfilled" && ssrResult.value;
  status.fileCache = fileResult.status === "fulfilled" && fileResult.value;

  const enabledCount = [status.transformCache, status.ssrModuleCache, status.fileCache]
    .filter(Boolean).length;

  if (enabledCount > 0) {
    logger.info("[Redis] Cache initialization complete", {
      enabled: enabledCount,
      transform: status.transformCache,
      ssrModule: status.ssrModuleCache,
      file: status.fileCache,
    });
  } else {
    logger.warn("[Redis] No caches enabled despite REDIS_URL being set");
  }

  return status;
}
