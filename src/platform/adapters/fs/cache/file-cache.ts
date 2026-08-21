/**
 * File Cache - Backend-Abstracted Architecture
 *
 * Caches file content with secure multi-tenant support.
 *
 * Strategy:
 * - Uses CacheBackend abstraction for backend selection
 * - API Mode (production): Uses veryfront-api for centralized cache
 * - Redis Mode (local dev/open source): Direct Redis access
 * - Memory Mode (fallback): In-memory cache
 *
 * Security: In production, renderer has no Redis credentials.
 * All cache access goes through the API which enforces tenant isolation.
 */

import { logger as baseLogger } from "#veryfront/utils";
import { registerCache } from "#veryfront/utils/memory/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { CacheEntry, CacheStats, FileCacheOptions } from "./types.ts";
import { estimateSize } from "./size-estimator.ts";
// Direct import to avoid circular dependency through cache/index.ts barrel
import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  getCachedWithBatching,
  getRequestCacheContext,
  setInRequestCache,
} from "#veryfront/cache/request-cache-batcher.ts";
import { isImmutableFileCacheKey } from "./immutable-keys.ts";

const logger = baseLogger.component("file-cache");

// Register with memory profiler
// Note: entries shows backend size when available, -1 for distributed backends
registerCache("file-cache", () => ({
  name: "file-cache",
  entries: cacheBackend?.size ?? -1,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: cacheBackend?.type ?? "uninitialized",
}));

/** Default TTL for cache entries (1 minute) */
const DEFAULT_CACHE_TTL_MS = 60_000;

/** Fallback cache max entries (small, for local dev) */
const FALLBACK_MAX_ENTRIES = 200;

/** Fallback cache max memory (10 MB, for local dev) */
const FALLBACK_MAX_MEMORY_BYTES = 10 * 1024 * 1024;

// Shared backend state across all FileCache instances
let cacheBackend: CacheBackend | null = null;
let backendInitialized = false;
let backendInitPromise: Promise<void> | null = null;

/**
 * Initialize file cache backend.
 * Call this at startup if you want to enable distributed caching.
 */
export async function initializeFileCacheBackend(): Promise<boolean> {
  if (backendInitialized) return cacheBackend?.type !== "memory";

  if (backendInitPromise) {
    await backendInitPromise;
    return cacheBackend?.type !== "memory";
  }

  backendInitPromise = withSpan("platform.fs.cache.initializeBackend", async () => {
    try {
      cacheBackend = await CacheBackends.file();
      logger.debug("Backend initialized", { type: cacheBackend.type });
    } catch (error) {
      logger.warn("Backend init failed, using memory fallback", { error });
      cacheBackend = new MemoryCacheBackend(FALLBACK_MAX_ENTRIES);
    } finally {
      backendInitialized = true;
    }
  }) as Promise<void>;

  await backendInitPromise;
  backendInitPromise = null;

  return cacheBackend?.type !== "memory";
}

/**
 * Check if distributed caching is enabled for file cache.
 */
export function isFileCacheDistributedEnabled(): boolean {
  return cacheBackend !== null && cacheBackend.type !== "memory";
}

/**
 * FileCache - Backend-First with Local Fallback
 *
 * When backend is available: Uses backend (API/Redis)
 * When backend unavailable: Small memory fallback for local dev
 */
/**
 * Process-local store for entries whose keys embed a release identity
 * (see {@link isImmutableFileCacheKey}). With an eligible distributed backend,
 * reading one otherwise costs an HTTP round trip on every request, in every
 * replica, and a single SSR render was measured issuing thousands of them
 * (veryfront-issue-inbox#602).
 *
 * Isolation: an entry is scoped on the authority the backend would authorise
 * the read with, which the backend resolves itself
 * ({@link CacheBackend.resolveAuthorityScope}). Two credentials or two projects
 * therefore never share an entry, and an authority the backend cannot resolve
 * disables the store for that read rather than falling back to a shared scope.
 *
 * Invalidation: the store does have one, because production invalidates these
 * prefixes even though the keys embed a release. See the release and env
 * prefix clears in `veryfront/websocket-manager.ts` and `veryfront/adapter.ts`.
 * Every write and delete drops the entries it covers, and holds admission for
 * those keys until its backend call settles, so a read taken inside that window
 * bypasses the store instead of pinning a pre-delete value with no TTL.
 * Eviction is a memory bound, not a correctness mechanism.
 */
const IMMUTABLE_L1_MAX_ENTRIES = 2_000;
/** Skip outsized entries rather than let one file evict the whole working set. */
const IMMUTABLE_L1_MAX_ENTRY_BYTES = 512 * 1024;
/** Retained bound, so the entry count cannot imply a multi-GB ceiling. */
const IMMUTABLE_L1_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const immutableL1 = new Map<string, { raw: string; size: number }>();
let immutableL1BytesUsed = 0;
let immutableL1MutationGeneration = 0;

/** A mutation whose backend call has not settled yet. */
type ImmutableL1Mutation =
  | { kind: "key"; key: string }
  | { kind: "prefix"; prefix: string }
  | { kind: "prefixSuffix"; prefix: string; suffix: string };

const immutableL1InFlightMutations = new Set<ImmutableL1Mutation>();

function immutableL1AuthorityScope(backend: CacheBackend, key: string): string | null {
  if (!isImmutableFileCacheKey(key)) return null;
  if (backend.type !== "api") return backend.type;
  // The api backend authorises with a credential this module must not
  // re-derive. Fail closed when it cannot name the authority.
  return backend.resolveAuthorityScope?.() ?? null;
}

function immutableL1Key(scope: string, key: string): string {
  return `${scope}\n${key}`;
}

function immutableL1SourceKey(scopedKey: string): string {
  const separator = scopedKey.indexOf("\n");
  return separator === -1 ? scopedKey : scopedKey.slice(separator + 1);
}

function immutableL1MutationCovers(mutation: ImmutableL1Mutation, key: string): boolean {
  switch (mutation.kind) {
    case "key":
      return mutation.key === key;
    case "prefix":
      return key.startsWith(mutation.prefix);
    case "prefixSuffix":
      return key.startsWith(mutation.prefix) && key.endsWith(mutation.suffix);
  }
}

/**
 * Whether an unresolved mutation still covers `key`. A global generation
 * counter only catches a mutation that lands while a read is in flight, so
 * admission needs this per-key and per-prefix barrier as well.
 */
function immutableL1AdmissionBlocked(key: string): boolean {
  for (const mutation of immutableL1InFlightMutations) {
    if (immutableL1MutationCovers(mutation, key)) return true;
  }
  return false;
}

/**
 * Drop the entries a mutation covers and block admission for those keys until
 * its backend call settles. Call the returned function in a `finally`, so a
 * rejected mutation cannot leave a permanent block behind.
 */
function immutableL1BeginMutation(mutation: ImmutableL1Mutation): () => void {
  immutableL1InFlightMutations.add(mutation);
  immutableL1MutationGeneration++;
  for (const scopedKey of [...immutableL1.keys()]) {
    if (immutableL1MutationCovers(mutation, immutableL1SourceKey(scopedKey))) {
      immutableL1Delete(scopedKey);
    }
  }
  return (): void => {
    immutableL1InFlightMutations.delete(mutation);
  };
}

function immutableL1Get(scopedKey: string): string | undefined {
  const hit = immutableL1.get(scopedKey);
  if (hit === undefined) return undefined;
  // Re-insert so eviction order is least-recently-used rather than insertion.
  immutableL1.delete(scopedKey);
  immutableL1.set(scopedKey, hit);
  return hit.raw;
}

function immutableL1Delete(scopedKey: string): void {
  const existing = immutableL1.get(scopedKey);
  if (existing === undefined) return;
  immutableL1BytesUsed -= existing.size;
  immutableL1.delete(scopedKey);
}

function immutableL1Set(scopedKey: string, raw: string): void {
  // estimateSize is the accounting the fallback cache already uses, and it
  // reads the length rather than copying the value on this hot path.
  const size = estimateSize(raw);
  if (size > IMMUTABLE_L1_MAX_ENTRY_BYTES) return;

  immutableL1Delete(scopedKey);
  immutableL1.set(scopedKey, { raw, size });
  immutableL1BytesUsed += size;

  while (
    immutableL1.size > IMMUTABLE_L1_MAX_ENTRIES ||
    immutableL1BytesUsed > IMMUTABLE_L1_MAX_TOTAL_BYTES
  ) {
    const oldest = immutableL1.keys().next().value;
    if (oldest === undefined) break;
    immutableL1Delete(oldest);
  }
}

/** Test seam: the store is process-global, so suites must be able to reset it. */
export function clearImmutableFileCacheL1(): void {
  immutableL1MutationGeneration++;
  immutableL1.clear();
  immutableL1BytesUsed = 0;
  immutableL1InFlightMutations.clear();
}

/** Test seam: proves a settled mutation leaves no admission block behind. */
export function immutableFileCacheL1InFlightMutationCount(): number {
  return immutableL1InFlightMutations.size;
}

export class FileCache {
  private fallbackCache = new Map<string, CacheEntry<unknown>>();
  private fallbackMemoryUsed = 0;
  private options: Required<FileCacheOptions>;
  private backendTtlSeconds: number;
  private hits = 0;
  private misses = 0;

  constructor(options: FileCacheOptions = {}) {
    this.options = {
      enabled: true,
      ttl: DEFAULT_CACHE_TTL_MS,
      maxSize: FALLBACK_MAX_ENTRIES,
      maxMemory: FALLBACK_MAX_MEMORY_BYTES,
      ...options,
    };
    this.backendTtlSeconds = Math.max(1, Math.ceil(this.options.ttl / 1000));

    const mode = cacheBackend?.type ?? "memory";
    logger.debug("Initialized", { ...this.options, mode });
  }

  private getBackend(): CacheBackend | null {
    if (!cacheBackend || cacheBackend.type === "memory") return null;
    return cacheBackend;
  }

  /**
   * Synchronous get - only checks fallback cache (for local dev without backend).
   * In production with backend, use getAsync instead.
   */
  get<T>(key: string): T | undefined {
    if (!this.options.enabled) {
      this.misses++;
      return undefined;
    }

    // In distributed mode, sync get always misses - use getAsync
    if (this.getBackend()) {
      this.misses++;
      return undefined;
    }

    const entry = this.fallbackCache.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Async get - checks backend (primary) or fallback memory cache.
   * Uses request-scoped batching for API backend to reduce N+1 queries.
   */
  getAsync<T>(key: string): Promise<T | undefined> {
    if (!this.options.enabled) {
      this.misses++;
      return Promise.resolve(undefined);
    }

    const backend = this.getBackend();
    if (!backend) return Promise.resolve(this.get<T>(key));

    return withSpan(
      "platform.fs.cache.getAsync",
      async () => {
        try {
          // Use request-scoped batching to dedupe and batch cache requests
          // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
          // The backend will add its own namespace prefix, so we pass the key as-is
          const requestCache = getRequestCacheContext();
          const requestCacheAlreadyHasValue = requestCache?.cache.has(key) ?? false;
          // A read that starts while a mutation for this key is unresolved
          // bypasses the process-local store entirely: the backend can still be
          // serving the pre-mutation value, and pinning it would outlive the
          // mutation.
          const l1Scope = requestCacheAlreadyHasValue || immutableL1AdmissionBlocked(key)
            ? null
            : immutableL1AuthorityScope(backend, key);
          const l1Key = l1Scope ? immutableL1Key(l1Scope, key) : null;
          const cached = l1Key ? immutableL1Get(l1Key) : undefined;
          const mutationGeneration = immutableL1MutationGeneration;
          const raw = cached ?? await getCachedWithBatching(backend, key);
          if (raw) {
            if (
              l1Key &&
              cached === undefined &&
              mutationGeneration === immutableL1MutationGeneration
            ) {
              immutableL1Set(l1Key, raw);
            }
            const entry = JSON.parse(raw) as CacheEntry<T>;
            // When using backend (Redis/API), trust the backend's TTL for expiry.
            // The backend TTL is derived from this.options.ttl and handles expiry.
            this.hits++;
            return entry.value;
          }
        } catch (error) {
          logger.debug("Backend get failed", { key, error });
        }

        this.misses++;
        return undefined;
      },
      { "cache.key": key, "cache.backend": backend.type },
    );
  }

  /**
   * Synchronous set - only writes to fallback cache (for local dev without backend).
   * In production with backend, use setAsync instead.
   */
  set<T>(key: string, value: T): void {
    if (!this.options.enabled) return;
    const settleMutation = immutableL1BeginMutation({ kind: "key", key });
    let settleOnReturn = true;

    try {
      const size = estimateSize(value);
      const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };

      // In distributed mode, fire-and-forget to backend
      // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
      const backend = this.getBackend();
      if (backend) {
        let serialized: string;
        try {
          serialized = JSON.stringify(entry);
        } catch (error) {
          logger.debug("Backend set skipped because the cache entry is not serializable", {
            key,
            error,
          });
          return;
        }
        // Update request-scoped cache so subsequent reads in same request see the new value
        setInRequestCache(key, serialized);
        // The write is only authoritative once the backend has it, so hold
        // admission until then.
        settleOnReturn = false;
        backend.set(key, serialized, this.backendTtlSeconds)
          .catch((error) => {
            logger.warn("Backend set failed", { key, error });
          })
          .finally(settleMutation);
        return;
      }

      this.setToFallback(key, entry, size);
    } finally {
      if (settleOnReturn) settleMutation();
    }
  }

  /**
   * Async set - writes to backend (primary) or fallback memory cache.
   */
  setAsync<T>(key: string, value: T): Promise<void> {
    const settleMutation = immutableL1BeginMutation({ kind: "key", key });
    if (!this.options.enabled) {
      settleMutation();
      return Promise.resolve();
    }

    const size = estimateSize(value);
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };

    // Try backend first
    // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
    const backend = this.getBackend();
    if (!backend) {
      this.setToFallback(key, entry, size);
      settleMutation();
      return Promise.resolve();
    }

    return withSpan(
      "platform.fs.cache.setAsync",
      async () => {
        try {
          const serialized = JSON.stringify(entry);
          // Update request-scoped cache so subsequent reads in same request see the new value
          setInRequestCache(key, serialized);
          await backend.set(key, serialized, this.backendTtlSeconds);
        } catch (error) {
          logger.debug("Backend set failed, skipping fallback", { key, error });
        } finally {
          settleMutation();
        }
      },
      { "cache.key": key, "cache.backend": backend.type, "cache.size": size },
    );
  }

  /** Write to fallback memory cache with size check and eviction. */
  private setToFallback<T>(key: string, entry: CacheEntry<T>, size: number): void {
    if (size > this.options.maxMemory) {
      logger.warn("Value too large for fallback cache", { key, size });
      return;
    }

    this.evictFallbackIfNeeded(size);
    this.fallbackCache.set(key, entry);
    this.fallbackMemoryUsed += size;
  }

  has(key: string): boolean {
    if (!this.options.enabled) return false;
    if (this.getBackend()) return false; // Use hasAsync for distributed mode

    const entry = this.fallbackCache.get(key);
    if (!entry) return false;

    if (Date.now() - entry.timestamp > this.options.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    // No backend call, so there is no window to hold admission across.
    immutableL1BeginMutation({ kind: "key", key })();
    const entry = this.fallbackCache.get(key);
    if (entry) this.fallbackMemoryUsed -= entry.size;
    return this.fallbackCache.delete(key);
  }

  deleteAsync(key: string): Promise<boolean> {
    const settleMutation = immutableL1BeginMutation({ kind: "key", key });
    return withSpan(
      "platform.fs.cache.deleteAsync",
      async () => {
        try {
          const deletedFromFallback = this.delete(key);
          // setAsync() publishes distributed writes into the request-scoped
          // cache before awaiting the backend. Invalidate that view as part of
          // the same delete, or this request can keep reading a value that the
          // backend no longer contains.
          setInRequestCache(key, null);
          const backend = this.getBackend();
          if (backend) {
            await backend.del(key);
          }
          return deletedFromFallback;
        } finally {
          settleMutation();
        }
      },
      { "cache.key": key },
    );
  }

  /** Clears only the in-memory fallback cache entries by prefix. Does NOT touch the backend. */
  private clearLocalByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.fallbackCache.keys()) {
      if (!key.startsWith(prefix)) continue;
      const entry = this.fallbackCache.get(key);
      if (entry) this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(key);
      count++;
    }
    return count;
  }

  /** Clears only the in-memory fallback cache entries by prefix+suffix. Does NOT touch the backend. */
  private clearLocalByPrefixAndSuffix(prefix: string, suffix: string): number {
    let count = 0;
    const suffixWithColon = `:${suffix}`;
    for (const key of this.fallbackCache.keys()) {
      if (!key.startsWith(prefix) || !key.endsWith(suffixWithColon)) continue;
      const entry = this.fallbackCache.get(key);
      if (entry) this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(key);
      count++;
    }
    return count;
  }

  deleteByPrefix(prefix: string): number {
    const settleMutation = immutableL1BeginMutation({ kind: "prefix", prefix });
    const count = this.clearLocalByPrefix(prefix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    const pending = cacheBackend?.delByPattern?.(`${prefix}*`);
    if (pending) {
      pending.catch((error) => {
        logger.warn("Backend invalidation failed", { prefix, error });
      }).finally(settleMutation);
    } else {
      settleMutation();
    }

    return count;
  }

  deleteByPrefixAsync(prefix: string): Promise<number> {
    const settleMutation = immutableL1BeginMutation({ kind: "prefix", prefix });
    return withSpan(
      "platform.fs.cache.deleteByPrefixAsync",
      async () => {
        try {
          // Clear local cache first, then await the single backend deletion.
          // Intentionally does NOT call deleteByPrefix() to avoid a double backend
          // delete (sync fire-and-forget + async await on the same pattern).
          const count = this.clearLocalByPrefix(prefix);

          // Await backend deletion for cross-pod consistency
          // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
          if (cacheBackend?.delByPattern) {
            await cacheBackend.delByPattern(`${prefix}*`);
          }

          return count;
        } finally {
          settleMutation();
        }
      },
      { "cache.prefix": prefix },
    );
  }

  deleteByPrefixAndSuffix(prefix: string, suffix: string): number {
    const settleMutation = immutableL1BeginMutation({ kind: "prefixSuffix", prefix, suffix });
    const count = this.clearLocalByPrefixAndSuffix(prefix, suffix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    const pending = cacheBackend?.delByPattern?.(`${prefix}*:${suffix}`);
    if (pending) {
      pending.catch((error) => {
        logger.warn("Backend invalidation failed", { prefix, suffix, error });
      }).finally(settleMutation);
    } else {
      settleMutation();
    }

    return count;
  }

  deleteByPrefixAndSuffixAsync(prefix: string, suffix: string): Promise<number> {
    const settleMutation = immutableL1BeginMutation({ kind: "prefixSuffix", prefix, suffix });
    return withSpan(
      "platform.fs.cache.deleteByPrefixAndSuffixAsync",
      async () => {
        try {
          // Clear local cache first, then await the single backend deletion.
          // Intentionally does NOT call deleteByPrefixAndSuffix() to avoid a double backend
          // delete (sync fire-and-forget + async await on the same pattern).
          const count = this.clearLocalByPrefixAndSuffix(prefix, suffix);

          // Await backend deletion for cross-pod consistency
          // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
          if (cacheBackend?.delByPattern) {
            await cacheBackend.delByPattern(`${prefix}*:${suffix}`);
          }

          return count;
        } finally {
          settleMutation();
        }
      },
      { "cache.prefix": prefix, "cache.suffix": suffix },
    );
  }

  clear(): void {
    clearImmutableFileCacheL1();
    this.fallbackCache.clear();
    this.fallbackMemoryUsed = 0;
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats & { backend: string } {
    const total = this.hits + this.misses;

    return {
      size: this.fallbackCache.size,
      memoryUsed: this.fallbackMemoryUsed,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
      backend: cacheBackend?.type ?? "uninitialized",
    };
  }

  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.fallbackCache) {
      if (now - entry.timestamp <= this.options.ttl) continue;

      this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(key);
      evicted++;
    }

    return evicted;
  }

  private evictFallbackIfNeeded(newSize: number): void {
    const evictOldest = (): void => {
      const oldest = this.fallbackCache.keys().next().value as string | undefined;
      if (!oldest) return;

      const entry = this.fallbackCache.get(oldest);
      if (entry) this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(oldest);
    };

    while (this.fallbackCache.size >= this.options.maxSize) {
      evictOldest();
    }

    while (
      this.fallbackMemoryUsed + newSize > this.options.maxMemory && this.fallbackCache.size > 0
    ) {
      evictOldest();
    }
  }
}
