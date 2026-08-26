/** Provider-neutral cache helpers shared with distributed store extensions. */

export { MAX_CACHE_REVISION_LENGTH } from "#veryfront/cache/types.ts";
export type {
  CacheBackend,
  CacheReadOptions,
  CacheRevisionMutation,
  CacheRevisionSnapshot,
  RevisionedCacheBackend,
} from "#veryfront/cache/types.ts";
export type { ResolvedCacheAuthority } from "#veryfront/cache/request-authority.ts";
export {
  assertCacheReadMaximumBytes,
  assertCacheValueWithinLimit,
  CacheValueTooLargeError,
} from "#veryfront/cache/bounded-read.ts";
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

/** Bounded provider-neutral cache listing request. */
export interface DistributedCacheListOptions {
  readonly prefix: string;
  readonly limit: number;
}

/** Immutable bounded cache listing with explicit completeness. */
export interface DistributedCacheKeyListing {
  readonly keys: readonly string[];
  readonly truncated: boolean;
}

/** Narrow administrative surface used by cache diagnostics and invalidation. */
export interface DistributedCacheAdministration {
  isConfigured(): boolean;
  listKeys(options: DistributedCacheListOptions): Promise<DistributedCacheKeyListing>;
  deleteKeys(keys: readonly string[]): Promise<number>;
}
