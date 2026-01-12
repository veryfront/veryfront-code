/**
 * SSR Module Loader
 *
 * Loads and transforms React components for server-side rendering.
 * Supports Redis caching to share transformed modules across pods.
 *
 * @module module-system/react-loader/ssr-module-loader
 */

// Main loader class
export { SSRModuleLoader } from "./loader.ts";

// Types
export type {
  FailureRecord,
  ModuleCacheEntry,
  SSRModuleCacheStats,
  SSRModuleLoaderOptions,
} from "./types.ts";

// Constants
export {
  CIRCUIT_BREAKER_RESET_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  MAX_CONCURRENT_TRANSFORMS,
  REDIS_KEY_PREFIX,
  REDIS_TTL_SECONDS,
  SSR_MODULE_CACHE_MAX_ENTRIES,
  SSR_MODULE_CACHE_TTL_MS,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "./constants.ts";

// Cache functions
export {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  globalModuleCache,
  initializeSSRRedisCache,
  isSSRRedisCacheEnabled,
} from "./cache/index.ts";

// Concurrency
export { Semaphore } from "./concurrency/index.ts";

// Stats function
import { SSR_MODULE_CACHE_MAX_ENTRIES } from "./constants.ts";
import { getRedisEnabled, globalModuleCache, globalTmpDirs } from "./cache/index.ts";
import type { SSRModuleCacheStats } from "./types.ts";

/**
 * Get SSR module cache statistics.
 */
export function getSSRModuleCacheStats(): SSRModuleCacheStats {
  return {
    memoryEntries: globalModuleCache.size,
    maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
    tmpDirs: globalTmpDirs.size,
    redisEnabled: getRedisEnabled(),
  };
}
