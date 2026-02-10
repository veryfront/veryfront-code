/**
 * React Loader - Ssr Module Loader
 *
 * @module modules/react-loader/ssr-module-loader
 */

export { SSRModuleLoader } from "./loader.ts";

export type {
  FailureRecord,
  ModuleCacheEntry,
  SSRModuleCacheStats,
  SSRModuleLoaderOptions,
} from "./types.ts";

export {
  CIRCUIT_BREAKER_RESET_MS,
  CIRCUIT_BREAKER_THRESHOLD,
  getMaxConcurrentTransforms,
  getTransformPerProjectLimit,
  REDIS_KEY_PREFIX,
  SSR_MODULE_CACHE_MAX_ENTRIES,
  SSR_MODULE_CACHE_TTL_MS,
  SSR_TMP_DIRS_MAX_ENTRIES,
} from "./constants.ts";

export {
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  globalModuleCache,
  initializeSSRDistributedCache,
  isSSRDistributedCacheEnabled,
} from "./cache/index.ts";

export { Semaphore } from "./concurrency/index.ts";

import { SSR_MODULE_CACHE_MAX_ENTRIES } from "./constants.ts";
import { globalModuleCache, globalTmpDirs, isSSRDistributedCacheEnabled } from "./cache/index.ts";
import type { SSRModuleCacheStats } from "./types.ts";

export function getSSRModuleCacheStats(): SSRModuleCacheStats {
  return {
    memoryEntries: globalModuleCache.size,
    maxEntries: SSR_MODULE_CACHE_MAX_ENTRIES,
    tmpDirs: globalTmpDirs.size,
    distributedCacheEnabled: isSSRDistributedCacheEnabled(),
  };
}
