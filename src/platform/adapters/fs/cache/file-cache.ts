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
import { type CacheBackend, CacheBackends } from "#veryfront/cache/backend.ts";
import {
  getCachedWithBatching,
  setInRequestCache,
} from "#veryfront/cache/request-cache-batcher.ts";
import { MAX_CACHE_TTL_MILLISECONDS } from "#veryfront/cache/backends/ttl.ts";

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

/** Avoid hot-looping backend construction after a transient startup failure. */
const BACKEND_INIT_RETRY_MS = 30_000;

// Shared backend state across all FileCache instances
let cacheBackend: CacheBackend | null = null;
let backendInitialized = false;
let backendInitPromise: Promise<void> | null = null;
let lastBackendInitFailureTime: number | undefined;

/**
 * Initialize file cache backend.
 * Call this at startup if you want to enable distributed caching.
 */
export async function initializeFileCacheBackend(): Promise<boolean> {
  if (backendInitialized) return cacheBackend !== null && cacheBackend.type !== "memory";

  if (
    lastBackendInitFailureTime !== undefined &&
    Date.now() - lastBackendInitFailureTime < BACKEND_INIT_RETRY_MS
  ) {
    return false;
  }

  if (backendInitPromise) {
    await backendInitPromise;
    return cacheBackend !== null && cacheBackend.type !== "memory";
  }

  const initialization = withSpan("platform.fs.cache.initializeBackend", async () => {
    try {
      const candidate = await CacheBackends.file();
      if (candidate.type === "memory") {
        // The factory's memory result is a safe per-call degradation, not proof
        // that a distributed backend can never become available. Retain the
        // instance-local fallback and allow a bounded later retry.
        cacheBackend = null;
        backendInitialized = false;
        lastBackendInitFailureTime = Date.now();
        logger.debug("Distributed backend unavailable; retry scheduled");
        return;
      }

      cacheBackend = candidate;
      backendInitialized = true;
      lastBackendInitFailureTime = undefined;
      logger.debug("Backend initialized", { type: candidate.type });
    } catch (error) {
      logger.warn("Backend init failed; instance-local caches remain active", { error });
      cacheBackend = null;
      backendInitialized = false;
      lastBackendInitFailureTime = Date.now();
    }
  }) as Promise<void>;
  backendInitPromise = initialization;

  try {
    await initialization;
  } finally {
    if (backendInitPromise === initialization) backendInitPromise = null;
  }

  return cacheBackend !== null && cacheBackend.type !== "memory";
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
      ...options,
    };
    validateOptions(this.options);
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

    if (Date.now() - entry.timestamp >= this.options.ttl) {
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
          const raw = await getCachedWithBatching(backend, key);
          if (raw) {
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

    const size = estimateSize(value);
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };

    // In distributed mode, fire-and-forget to backend
    // Note: key already includes the full prefix from buildFileCacheKeyPrefix (e.g., "file:env:project:...")
    const backend = this.getBackend();
    if (backend) {
      const serialized = JSON.stringify(entry);
      // Update request-scoped cache so subsequent reads in same request see the new value
      setInRequestCache(backend, key, serialized);
      backend.set(key, serialized, this.backendTtlSeconds).catch((error) => {
        logger.warn("Backend set failed", { key, error });
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
          setInRequestCache(backend, key, serialized);
          await backend.set(key, serialized, this.backendTtlSeconds);
        } catch (error) {
          logger.debug("Backend set failed, skipping fallback", { key, error });
        }
      },
      { "cache.key": key, "cache.backend": backend.type, "cache.size": size },
    );
  }

  /** Write to fallback memory cache with size check and eviction. */
  private setToFallback<T>(key: string, entry: CacheEntry<T>, size: number): void {
    const previous = this.fallbackCache.get(key);
    if (previous) {
      this.fallbackCache.delete(key);
      this.fallbackMemoryUsed -= previous.size;
    }

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

    if (Date.now() - entry.timestamp >= this.options.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const entry = this.fallbackCache.get(key);
    if (entry) this.fallbackMemoryUsed -= entry.size;
    return this.fallbackCache.delete(key);
  }

  deleteAsync(key: string): Promise<boolean> {
    return withSpan(
      "platform.fs.cache.deleteAsync",
      async () => {
        const deletedFromFallback = this.delete(key);
        const backend = this.getBackend();
        if (backend) {
          await backend.del(key);
        }
        return deletedFromFallback;
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
    const count = this.clearLocalByPrefix(prefix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    cacheBackend?.delByPattern?.(`${prefix}*`).catch((error) => {
      logger.warn("Backend invalidation failed", { prefix, error });
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
          await cacheBackend.delByPattern(`${prefix}*`);
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
          await cacheBackend.delByPattern(`${prefix}*:${suffix}`);
        }

        return count;
      },
      { "cache.prefix": prefix, "cache.suffix": suffix },
    );
  }

  clear(): void {
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
      if (now - entry.timestamp < this.options.ttl) continue;

      this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(key);
      evicted++;
    }

    return evicted;
  }

  private evictFallbackIfNeeded(newSize: number): void {
    const evictOldest = (): boolean => {
      const oldest = this.fallbackCache.keys().next();
      if (oldest.done) return false;

      const entry = this.fallbackCache.get(oldest.value);
      if (entry) this.fallbackMemoryUsed -= entry.size;
      this.fallbackCache.delete(oldest.value);
      return true;
    };

    while (this.fallbackCache.size >= this.options.maxSize) {
      if (!evictOldest()) break;
    }

    while (
      this.fallbackMemoryUsed + newSize > this.options.maxMemory && this.fallbackCache.size > 0
    ) {
      if (!evictOldest()) break;
    }
  }
}

function validateOptions(options: Required<FileCacheOptions>): void {
  if (typeof options.enabled !== "boolean") {
    throw new TypeError("File cache enabled must be a boolean");
  }
  if (
    !Number.isSafeInteger(options.ttl) || options.ttl <= 0 ||
    options.ttl > MAX_CACHE_TTL_MILLISECONDS
  ) {
    throw new RangeError(
      `File cache TTL must be a positive integer no greater than ${MAX_CACHE_TTL_MILLISECONDS} milliseconds`,
    );
  }
  if (!Number.isSafeInteger(options.maxSize) || options.maxSize <= 0) {
    throw new RangeError("File cache maxSize must be a positive safe integer");
  }
  if (!Number.isSafeInteger(options.maxMemory) || options.maxMemory <= 0) {
    throw new RangeError("File cache maxMemory must be a positive safe integer");
  }
}
