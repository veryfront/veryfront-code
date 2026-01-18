/**
 * Cache module - centralized caching infrastructure
 *
 * @module cache
 */

// Backend exports
export * from "./backend.ts";

// Cache key builder exports
export {
  type CacheKeyContext,
  createCacheKeyFilter,
  extractCacheKeyContext,
  extractCacheKeyContextFromRequestContext,
  getContentHashKey,
  getCurrentCacheKeyContext,
  getProjectScopedKey,
  getProjectScopedKeyAlways,
  isKeyForProject,
  type MultiProjectRequestContext,
  runWithCacheKeyContext,
  tryGetCacheKeyContext,
} from "./cache-key-builder.ts";

// Key builder exports (avoiding conflicts with cache-key-builder)
export {
  buildComponentCacheKey,
  buildConfigCacheKey,
  buildContentHashCacheKey,
  buildContentHashKey,
  buildDirCacheKeyPrefix,
  buildErrorPageCacheKey,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildFileOperationCacheKey,
  buildGitHubBytesCacheKey,
  buildGitHubContentCacheKey,
  buildGitHubDirCacheKey,
  buildGitHubResolveCacheKey,
  buildGitHubStatCacheKey,
  buildGitHubTreeCacheKey,
  buildLayoutComponentCacheKey,
  buildModuleResolveCacheKey,
  buildModuleTransformCacheKey,
  buildProxyManagerCacheKey,
  buildRedisFileCacheKey,
  buildRedisSSRModuleKey,
  buildRedisTransformKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  buildSSRModuleCacheKey,
  buildSSRModuleProjectKey,
  buildStatCacheKeyPrefix,
  buildTransformCacheKey,
  CacheKeyPrefix,
  cacheRegistry,
  deleteAllKeysForProject,
  deleteAllKeysForProjectAsync,
  type FileOperationContext,
  type FileSourceType,
  getAllKeysForProject,
  getAllKeysForProjectAsync,
  getCacheKeyVersion,
  parseRenderCacheKey,
} from "./keys.ts";

// Registry exports (avoiding conflicts with keys.ts)
export {
  type CacheStore,
  extractProjectIdFromKey,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
} from "./registry.ts";
