/**
 * Cache Module
 *
 * Exports for SSR module caching.
 *
 * @module module-system/react-loader/ssr-module-loader/cache
 */

// Memory caches
export {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  failedComponents,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  transformSemaphore,
} from "./memory.ts";

// Distributed caching (Redis backend)
export {
  getFromRedis,
  getRedisClientInstance,
  getRedisEnabled,
  initializeSSRDistributedCache,
  initializeSSRRedisCache,
  isSSRDistributedCacheEnabled,
  isSSRRedisCacheEnabled,
  redisKey,
  setInRedis,
} from "./redis.ts";
