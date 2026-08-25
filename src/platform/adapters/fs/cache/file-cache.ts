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
import {
  createImmutableFileCacheL1,
  isImmutableReleaseFileCacheKey,
  resolveImmutableL1Scope,
  resolveImmutableL1TtlMs,
} from "#veryfront/cache/immutable-l1.ts";

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

/**
 * Process-local tier in front of the distributed backend, shared by every
 * FileCache instance and separated internally by authority scope. It holds only
 * immutable release-scoped values, and only for a short TTL; see
 * cache/immutable-l1.ts for what that TTL bounds.
 */
const immutableL1 = createImmutableFileCacheL1();

/** Process-wide default entry lifetime for that tier, overridable per instance. */
const IMMUTABLE_L1_TTL_MS = resolveImmutableL1TtlMs();

/**
 * The single path by which this module publishes a value into the
 * request-scoped cache, and the place the process-local tier's per-key
 * generation is bumped for that write.
 *
 * These two must not be separable. `getAsync` decides whether a read may use
 * the L1 tier BEFORE it awaits the backend, so a write landing mid-read does
 * not make that read's `inRequestScope` guard true. What such a read receives
 * instead is this request's own optimistic value, handed back by
 * `getCachedWithBatching`'s mutation-version divergence path, and the only
 * thing that then keeps it out of the process-local tier is that the
 * generation token the read took no longer matches. If a request-cache write
 * ever happened without that bump, a value the backend never confirmed could
 * be admitted and served to LATER, SEPARATE requests for the rest of the TTL.
 *
 * Holding the two together by adjacency made that a one-line deletion away, and
 * the deletion passed the whole suite. They are one function instead.
 *
 * The bump is not folded into `setInRequestCache` itself: that lives in
 * `cache/request-cache-batcher.ts`, a layer BELOW this one, and the L1 store is
 * owned here. Making the batcher reach into it would invert the dependency and
 * would be meaningless for its other callers, which cache unrelated things.
 */
function publishToRequestCache(key: string, serialized: string | null): void {
  immutableL1.dropKey(key);
  setInRequestCache(key, serialized);
}

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
      immutableL1Ttl: IMMUTABLE_L1_TTL_MS,
      ...options,
    };
    // A non-finite lifetime would either stamp entries that never expire
    // (Infinity) or defeat every comparison it feeds (NaN), so it falls back
    // to the process-wide default the same way an unparseable env override
    // does. Zero and negative values still disable the tier.
    if (!Number.isFinite(this.options.immutableL1Ttl)) {
      this.options.immutableL1Ttl = IMMUTABLE_L1_TTL_MS;
    }
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
        // The process-local tier holds only immutable release-scoped values, and
        // only under the authority the backend read itself would have used.
        // Anything else, including every branch-scoped key, falls through to the
        // backend on every request.
        const l1Scope = this.options.immutableL1Ttl > 0 && isImmutableReleaseFileCacheKey(key)
          ? resolveImmutableL1Scope(backend.type, backend.cacheAuthority?.())
          : null;
        // A value already in the request-scoped cache may be this request's own
        // optimistic write rather than something the backend confirmed, so it
        // must neither be answered from nor promoted into the process-local tier.
        //
        // `pending` matters for the same reason and is not covered by `cache`.
        // `getCachedWithBatching` hands a read that starts now the promise of a
        // read that started EARLIER, and the generation token this call is about
        // to take is read AFTER any invalidation that landed in between. Without
        // this, a read starting after a delete or a prefix invalidation carries
        // a post-bump token while receiving a pre-invalidation value, and
        // reinstates exactly what was just invalidated for the whole TTL.
        const requestCtx = getRequestCacheContext();
        const inRequestScope = (requestCtx?.cache.has(key) ?? false) ||
          (requestCtx?.pending.has(key) ?? false);
        const useL1 = l1Scope !== null && !inRequestScope;

        try {
          if (useL1) {
            // The instance's own lifetime is enforced at lookup as well as
            // stamped at admission, so a short-TTL instance is never served
            // an entry a longer-TTL instance admitted past its own bound.
            const held = immutableL1.lookup(l1Scope, key, this.options.immutableL1Ttl);
            if (held !== null) {
              const entry = JSON.parse(held) as CacheEntry<T>;
              this.hits++;
              return entry.value;
            }
          }

          const readToken = immutableL1.beginRead(key);
          // Use request-scoped batching to dedupe and batch cache requests
          // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
          // The backend will add its own namespace prefix, so we pass the key as-is
          const raw = await getCachedWithBatching(backend, key);
          if (raw) {
            const entry = JSON.parse(raw) as CacheEntry<T>;
            if (useL1) {
              immutableL1.admit(l1Scope, key, raw, readToken, this.options.immutableL1Ttl);
            }
            // When using backend (Redis/API), trust the backend's TTL for expiry.
            // The backend TTL is derived from this.options.ttl and handles expiry.
            this.hits++;
            return entry.value;
          }
        } catch (error) {
          // A held value that will not parse must not be offered again.
          immutableL1.dropKey(key);
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

    const size = estimateSize(value);
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };
    // A write invalidates any held entry whichever storage path is taken below,
    // including the fallback one that never reaches the request cache. The
    // barrier for a write landing mid-read is a separate concern and lives in
    // publishToRequestCache; dropKey is idempotent, so both may run.
    immutableL1.dropKey(key);

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
      publishToRequestCache(key, serialized);
      backend.set(key, serialized, this.backendTtlSeconds).catch((error) => {
        logger.warn("Backend set failed", { key, error });
      }).finally(() => {
        // Dropped again once the write settles: a read racing this write can
        // have admitted the value the backend held before it landed, on a
        // generation token taken after the pre-write drop.
        immutableL1.dropKey(key);
      });
      return;
    }

    this.setToFallback(key, entry, size);
  }

  /**
   * Async set - writes to backend (primary) or fallback memory cache.
   */
  setAsync<T>(key: string, value: T): Promise<void> {
    if (!this.options.enabled) return Promise.resolve();

    const size = estimateSize(value);
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };
    // A write invalidates any held entry whichever storage path is taken below,
    // including the fallback one that never reaches the request cache. The
    // barrier for a write landing mid-read is a separate concern and lives in
    // publishToRequestCache; dropKey is idempotent, so both may run.
    immutableL1.dropKey(key);

    // Try backend first
    // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
    const backend = this.getBackend();
    if (!backend) {
      this.setToFallback(key, entry, size);
      return Promise.resolve();
    }

    return withSpan(
      "platform.fs.cache.setAsync",
      async () => {
        try {
          const serialized = JSON.stringify(entry);
          // Update request-scoped cache so subsequent reads in same request see the new value
          publishToRequestCache(key, serialized);
          await backend.set(key, serialized, this.backendTtlSeconds);
        } catch (error) {
          logger.debug("Backend set failed, skipping fallback", { key, error });
        } finally {
          // Dropped again once the write settles: a read racing this write can
          // have admitted the value the backend held before it landed, on a
          // generation token taken after the pre-write drop.
          immutableL1.dropKey(key);
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
    immutableL1.dropKey(key);
    const entry = this.fallbackCache.get(key);
    if (entry) this.fallbackMemoryUsed -= entry.size;
    return this.fallbackCache.delete(key);
  }

  deleteAsync(key: string): Promise<boolean> {
    return withSpan(
      "platform.fs.cache.deleteAsync",
      async () => {
        const deletedFromFallback = this.delete(key);
        // setAsync() publishes distributed writes into the request-scoped
        // cache before awaiting the backend. Invalidate that view as part of
        // the same delete, or this request can keep reading a value that the
        // backend no longer contains.
        publishToRequestCache(key, null);
        const backend = this.getBackend();
        if (backend) {
          try {
            await backend.del(key);
          } finally {
            // Dropped again after the backend deletion settles: a read that
            // raced it took its generation token after the drop above and can
            // have admitted the value the backend still held.
            immutableL1.dropKey(key);
          }
        }
        return deletedFromFallback;
      },
      { "cache.key": key },
    );
  }

  /** Clears only the in-memory fallback cache entries by prefix. Does NOT touch the backend. */
  private clearLocalByPrefix(prefix: string): number {
    immutableL1.dropPrefix(prefix);
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
    immutableL1.dropPrefix(prefix);
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
    const count = this.clearLocalByPrefix(prefix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    cacheBackend?.delByPattern?.(`${prefix}*`).catch((error) => {
      logger.warn("Backend invalidation failed", { prefix, error });
    }).finally(() => {
      // Dropped again after the backend deletion settles, so a read that
      // raced it cannot leave a just-invalidated value behind in the tier.
      immutableL1.dropPrefix(prefix);
    });

    return count;
  }

  deleteByPrefixAsync(prefix: string): Promise<number> {
    return withSpan(
      "platform.fs.cache.deleteByPrefixAsync",
      async () => {
        // Clear local cache first, then await the single backend deletion.
        // Intentionally does NOT call deleteByPrefix() to avoid a double backend
        // delete (sync fire-and-forget + async await on the same pattern).
        const count = this.clearLocalByPrefix(prefix);

        // Await backend deletion for cross-pod consistency
        // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
        if (cacheBackend?.delByPattern) {
          try {
            await cacheBackend.delByPattern(`${prefix}*`);
          } finally {
            // Dropped again after the backend deletion settles, so a read that
            // raced it cannot leave a just-invalidated value behind in the tier.
            immutableL1.dropPrefix(prefix);
          }
        }

        return count;
      },
      { "cache.prefix": prefix },
    );
  }

  deleteByPrefixAndSuffix(prefix: string, suffix: string): number {
    const count = this.clearLocalByPrefixAndSuffix(prefix, suffix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    cacheBackend?.delByPattern?.(`${prefix}*:${suffix}`).catch((error) => {
      logger.warn("Backend invalidation failed", { prefix, suffix, error });
    }).finally(() => {
      // Dropped again after the backend deletion settles; dropping the whole
      // prefix over-invalidates, which fails toward extra backend reads.
      immutableL1.dropPrefix(prefix);
    });

    return count;
  }

  deleteByPrefixAndSuffixAsync(prefix: string, suffix: string): Promise<number> {
    return withSpan(
      "platform.fs.cache.deleteByPrefixAndSuffixAsync",
      async () => {
        // Clear local cache first, then await the single backend deletion.
        // Intentionally does NOT call deleteByPrefixAndSuffix() to avoid a double backend
        // delete (sync fire-and-forget + async await on the same pattern).
        const count = this.clearLocalByPrefixAndSuffix(prefix, suffix);

        // Await backend deletion for cross-pod consistency
        // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
        if (cacheBackend?.delByPattern) {
          try {
            await cacheBackend.delByPattern(`${prefix}*:${suffix}`);
          } finally {
            // Dropped again after the backend deletion settles; dropping the
            // whole prefix over-invalidates, which fails toward extra backend
            // reads.
            immutableL1.dropPrefix(prefix);
          }
        }

        return count;
      },
      { "cache.prefix": prefix, "cache.suffix": suffix },
    );
  }

  clear(): void {
    // Coarser than the instance it is called on: this drops every scope's
    // entries. It fails toward extra backend reads, never toward stale content.
    immutableL1.clear();
    this.fallbackCache.clear();
    this.fallbackMemoryUsed = 0;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Counters for this instance, across every tier it reads through.
   *
   * `hits` does not separate tiers: a process-local immutable release hit, a
   * request-scoped hit and a backend hit all increment it, and `size` and
   * `memoryUsed` describe only the local fallback map. So a high hit rate here
   * does not by itself say how many backend round trips were avoided.
   */
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
    // The process-local immutable release tier reclaims expired entries on
    // admission and on touch; this maintenance entry point reclaims them for
    // an idle store as well, so expired file content is not retained until
    // the next admission happens to sweep it.
    let evicted = immutableL1.evictExpired();

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
