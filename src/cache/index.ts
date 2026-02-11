/**
 * Cache key generation, path tokenization, distributed cache initialization,
 * and LRU registry for components, modules, SSR output, and proxy responses.
 *
 * @module cache
 */

// Cache path tokenization
export { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "./paths.ts";

// Cache key builders
export {
  buildComponentCacheKey,
  buildDirCacheKeyPrefix,
  buildErrorPageCacheKey,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildGitHubBytesCacheKey,
  buildGitHubContentCacheKey,
  buildGitHubDirCacheKey,
  buildGitHubResolveCacheKey,
  buildGitHubStatCacheKey,
  buildGitHubTreeCacheKey,
  buildModuleResolveCacheKey,
  buildModuleTransformCacheKey,
  buildProxyManagerCacheKey,
  buildRedisSSRModuleKey,
  buildStatCacheKeyPrefix,
  cacheRegistry,
  type FileOperationContext,
} from "./keys/index.ts";

// Distributed cache initialization
export { initializeDistributedCaches } from "./distributed-cache-init.ts";

// Cache store registry
export { registerLRUCache } from "./registry.ts";
