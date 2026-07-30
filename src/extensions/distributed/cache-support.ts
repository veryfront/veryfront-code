/** Provider-neutral cache helpers shared with distributed store extensions. */

export type { CacheBackend } from "#veryfront/cache/types.ts";
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
  registerRenderDistributedCacheNamespace,
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
