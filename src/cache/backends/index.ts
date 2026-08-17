/**
 * Cache Backends
 *
 * @module cache/backends
 */

// Re-export CacheBackend interface from types
export type { CacheBackend } from "../types.ts";
export {
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
  CacheValueTooLargeError,
  captureBoundedCacheRead,
  readCacheValueWithinLimit,
} from "../bounded-read.ts";
export {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
  isRevisionedCacheKey,
  MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
  requireCacheExchangeResult,
  REVISIONED_CACHE_KEY_PREFIX,
  snapshotCacheRevisionResult,
} from "../capabilities.ts";
export { MAX_CACHE_REVISION_LENGTH } from "../types.ts";
export type {
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "../types.ts";

// Backend implementations
export { MemoryCacheBackend } from "./memory.ts";
export { RedisCacheBackend } from "./redis.ts";
export { ApiCacheBackend } from "./api.ts";
export { DiskCacheBackend } from "./disk.ts";

// Factory functions and config
export {
  type CacheBackendConfig,
  CacheBackends,
  createCacheBackend,
  createDistributedCacheAccessor,
  createDistributedCodeCacheAccessor,
  isApiCacheAvailable,
  isDiskCacheConfigured,
  isDistributedBackend,
  isLocalDevDiskCacheEnabled,
  isPersistentLocalCacheEnabled,
  localDevCodeCacheBackend,
} from "./factory.ts";

// Gateway re-exports
export type { CodeCacheGateway, TokenizingCacheGateway } from "./factory.ts";
export { createTokenizingGateway } from "./factory.ts";
