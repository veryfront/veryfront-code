/********************************************************************************
 * Centralized Cache Key Management
 *
 * All cache keys in the system should be built using these functions to ensure:
 * 1. Consistent format across the codebase
 * 2. Automatic version-based invalidation on deployments
 * 3. Proper tenant isolation for multi-project environments
 * 4. Easy maintenance and debugging
 *
 * @module core/cache/keys
 ********************************************************************************/

// Re-export registry symbols (preserved for backward compatibility)
export {
  cacheRegistry,
  type CacheStore,
  extractProjectIdFromKey,
  isKeyForProject,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
} from "../registry.ts";

// Prefixes, types, and constants
export {
  CacheKeyPrefix,
  DEFAULT_EXCLUDED_QUERY_PARAMS,
  type FileOperationContext,
  type FileSourceType,
  type QueryParamCacheOptions,
  type QueryParamPolicy,
  type TransformCacheKeyOptions,
} from "./prefixes.ts";

// Utilities: parsing, filtering, normalization
export {
  createCacheKeyFilter,
  deleteAllKeysForProject,
  deleteAllKeysForProjectAsync,
  filterQueryParams,
  getAllKeysForProject,
  getAllKeysForProjectAsync,
  getCacheKeyVersion,
  normalizeFilePath,
  parseRenderCacheKey,
  sanitizeQueryParamsForCacheKey,
} from "./utils.ts";

// File/dir/stat cache key builders
export {
  buildConfigCacheKey,
  buildDirCacheKeyPrefix,
  buildFileCacheKeyPrefix,
  buildFileListCacheKey,
  buildFileOperationCacheKey,
  buildStatCacheKeyPrefix,
} from "./builders/file.ts";

// GitHub adapter cache key builders
export {
  buildGitHubBytesCacheKey,
  buildGitHubContentCacheKey,
  buildGitHubDirCacheKey,
  buildGitHubResolveCacheKey,
  buildGitHubStatCacheKey,
  buildGitHubTreeCacheKey,
} from "./builders/github.ts";

// Module/SSR/transform cache key builders
export {
  buildBundleManifestCacheKey,
  buildContentHashCacheKey,
  buildModuleResolveCacheKey,
  buildModuleTransformCacheKey,
  buildRedisFileCacheKey,
  buildRedisSSRModuleKey,
  buildRedisTransformKey,
  buildSSRModuleCacheKey,
  buildSSRModuleProjectKey,
  buildTransformCacheKey,
} from "./builders/module.ts";

// Render/layout/component cache key builders
export {
  buildComponentCacheKey,
  buildErrorPageCacheKey,
  buildLayoutComponentCacheKey,
  buildProxyManagerCacheKey,
  buildQueryAwareCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
  computeContentSourceId,
} from "./builders/render.ts";
