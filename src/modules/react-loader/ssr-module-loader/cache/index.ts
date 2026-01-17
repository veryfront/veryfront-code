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

// Redis caching
export {
  getFromRedis,
  getRedisClientInstance,
  getRedisEnabled,
  initializeSSRRedisCache,
  isSSRRedisCacheEnabled,
  redisKey,
  setInRedis,
} from "./redis.ts";
