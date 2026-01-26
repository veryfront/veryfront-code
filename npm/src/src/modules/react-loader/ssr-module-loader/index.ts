export { SSRModuleLoader } from "./loader.js";

export type {
  FailureRecord,
  ModuleCacheEntry,
  SSRModuleCacheStats,
  SSRModuleLoaderOptions,
} from "./types.js";

export {
  CIRCUIT_BREAKER_RESET_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  MAX_CONCURRENT_TRANSFORMS,
  REDIS_KEY_PREFIX,
  REDIS_TTL_SECONDS,
  SSR_MODULE_CACHE_MAX_ENTRIES,
  SSR_MODULE_CACHE_TTL_MS,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "./constants.js";

export {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  globalModuleCache,
  initializeSSRDistributedCache,
  initializeSSRRedisCache,
  isSSRDistributedCacheEnabled,
  isSSRRedisCacheEnabled,
} from "./cache/index.js";

export { Semaphore } from "./concurrency/index.js";

import { SSR_MODULE_CACHE_MAX_ENTRIES } from "./constants.js";
import { getRedisEnabled, globalModuleCache, globalTmpDirs } from "./cache/index.js";
import type { SSRModuleCacheStats } from "./types.js";

export function getSSRModuleCacheStats(): SSRModuleCacheStats {
  return {
    memoryEntries: globalModuleCache.size,
    maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
    tmpDirs: globalTmpDirs.size,
    redisEnabled: getRedisEnabled(),
  };
}
