/**
 * Cache Backends
 *
 * @module cache/backends
 */

// Re-export cache contracts from types
export { MAX_CACHE_REVISION_LENGTH } from "../types.ts";
export type {
  CacheBackend,
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "../types.ts";
export {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
  isRevisionedCacheKey,
  MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
  requireCacheExchangeResult,
  REVISIONED_CACHE_KEY_PREFIX,
  snapshotCacheRevisionResult,
} from "../capabilities.ts";

// Backend implementations
export { MemoryCacheBackend } from "./memory.ts";
export { ApiCacheBackend } from "./api.ts";
export { DiskCacheBackend } from "./disk.ts";

// Factory functions and config
export {
  type CacheBackendConfig,
  CacheBackends,
  createCacheBackend,
  createDistributedCacheAccessor,
  createDistributedCodeCacheAccessor,
  getRuntimeCacheBackendSelection,
  isApiCacheAvailable,
  isDiskCacheConfigured,
  isDistributedBackend,
  type RuntimeCacheBackendSelection,
} from "./factory.ts";

// Gateway re-exports
export type { CodeCacheGateway, TokenizingCacheGateway } from "./factory.ts";
export { createTokenizingGateway } from "./factory.ts";
