/** Provider-neutral cache helpers shared with distributed store extensions. */

export { MAX_CACHE_REVISION_LENGTH } from "#veryfront/cache/types.ts";
export type {
  CacheBackend,
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
export {
  buildRevisionedCacheKey,
  isRevisionedCacheBackend,
  isRevisionedCacheKey,
  MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH,
  requireCacheExchangeResult,
  REVISIONED_CACHE_KEY_PREFIX,
  snapshotCacheRevisionResult,
} from "#veryfront/cache/capabilities.ts";
export { buildBatchResults } from "#veryfront/cache/batch-results.ts";
export { assertCacheBatchSize } from "#veryfront/cache/batch-policy.ts";
export {
  DEFAULT_CACHE_TTL_SECONDS,
  expiresImmediately,
  requirePositiveIntegerCacheTtlSeconds,
  resolveIntegerCacheTtlSeconds,
} from "#veryfront/cache/backends/ttl.ts";
export {
  escapeCacheGlobLiteral,
  registerOwnedDistributedCacheKeyPrefix,
  registerRenderDistributedCacheNamespace,
  stripOwnedDistributedCacheKeyPrefix,
  validateDistributedCacheKeyPrefix,
} from "#veryfront/cache/backends/distributed-keyspace.ts";
export {
  parseSerializedCachePayload,
  serializeCachePayload,
} from "#veryfront/rendering/cache/cache-payload.ts";
export type {
  CachePayload,
  CacheStore as RenderCacheStore,
  CacheStoreStats,
} from "#veryfront/rendering/cache/types.ts";
