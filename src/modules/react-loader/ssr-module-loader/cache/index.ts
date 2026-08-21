/**
 * Ssr Module Loader - Cache
 *
 * @module modules/react-loader/ssr-module-loader/cache
 */

export {
  acquireTransformSlot,
  clearSSRModuleCache,
  clearSSRModuleCacheForProject,
  failedComponents,
  getTransformSemaphore,
  getTransformStats,
  globalCrossProjectCache,
  globalInProgress,
  globalModuleCache,
  globalTmpDirs,
  releaseTransformSlot,
  tryAcquireTransformSlot,
} from "./memory.ts";

export type { ClearSSRModuleCacheForProjectOptions } from "./memory.ts";

export {
  drainBackgroundWrites,
  getFromRedis,
  initializeSSRDistributedCache,
  isSSRDistributedCacheEnabled,
  setInRedis,
  trackBackgroundWrite,
} from "./redis.ts";
