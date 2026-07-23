/**
 * File Cache - Backend-Abstracted Architecture
 *
 * Caches file content with secure multi-tenant support.
 *
 * Strategy:
 * - Uses CacheBackend abstraction for backend selection
 * - API Mode (production): Uses veryfront-api for centralized cache
 * - Redis Mode (local dev/open source): Direct Redis access
 * - Memory Mode: Explicit local in-memory cache selected by the backend factory
 *
 * Security: In production, renderer has no Redis credentials.
 * All cache access goes through the API which enforces tenant isolation.
 */

import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
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
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { CACHE_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { deserializeFileCacheEntry, serializeFileCacheEntry } from "./serialization.ts";

const logger = baseLogger.component("file-cache");

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

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

function validatePositiveFiniteOption(
  name: string,
  value: number,
  requireInteger = false,
): void {
  if (Number.isFinite(value) && value > 0 && (!requireInteger || Number.isInteger(value))) return;

  throw CONFIG_INVALID.create({
    detail: `File cache ${name} must be a positive finite ${requireInteger ? "integer" : "number"}`,
  });
}

// Shared backend state across all FileCache instances
let cacheBackend: CacheBackend | null = null;
let backendInitialized = false;
let backendInitPromise: Promise<CacheBackend> | null = null;

/**
 * Initialize file cache backend.
 * Call this at startup if you want to enable distributed caching.
 * Initialization failures reject explicitly and remain retryable. A backend
 * factory may deliberately select memory mode, which resolves to `false`.
 */
export async function initializeFileCacheBackend(): Promise<boolean> {
  if (backendInitialized) return cacheBackend?.type !== "memory";

  const pending = backendInitPromise ??
    (withSpan("platform.fs.cache.initializeBackend", async () => {
      try {
        const backend = await CacheBackends.file();
        logger.debug("Backend initialized", { type: backend.type });
        return backend;
      } catch (error) {
        logger.error("Backend initialization failed", { errorName: errorName(error) });
        throw CACHE_ERROR.create({
          message: "File cache backend initialization failed",
          cause: error,
        });
      }
    }) as Promise<CacheBackend>);
  backendInitPromise = pending;

  try {
    const backend = await pending;
    cacheBackend = backend;
    backendInitialized = true;
    return backend.type !== "memory";
  } finally {
    if (backendInitPromise === pending) backendInitPromise = null;
  }
}

/**
 * Check if distributed caching is enabled for file cache.
 */
export function isFileCacheDistributedEnabled(): boolean {
  return cacheBackend !== null && cacheBackend.type !== "memory";
}

/**
 * FileCache - Backend-First with Bounded Local Storage
 *
 * When backend is available: Uses backend (API/Redis)
 * When no backend is initialized: Small per-instance memory cache for local development
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
    validatePositiveFiniteOption("ttl", this.options.ttl);
    validatePositiveFiniteOption("maxSize", this.options.maxSize, true);
    validatePositiveFiniteOption("maxMemory", this.options.maxMemory);
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

    // Map iteration order is the fallback cache's LRU order. Move successful
    // reads to the end so capacity eviction removes the least recently used
    // entry instead of the oldest inserted entry.
    this.fallbackCache.delete(key);
    this.fallbackCache.set(key, entry);
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
            const entry = deserializeFileCacheEntry<T>(raw);
            // When using backend (Redis/API), trust the backend's TTL for expiry.
            // The backend TTL is derived from this.options.ttl and handles expiry.
            this.hits++;
            return entry.value;
          }
        } catch (error) {
          logger.debug("Backend get failed", { errorName: errorName(error) });
        }

        this.misses++;
        return undefined;
      },
      { "cache.backend": backend.type },
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
      try {
        const serialized = serializeFileCacheEntry(entry);
        // Update request-scoped cache so subsequent reads in same request see the new value
        setInRequestCache(key, serialized);
        backend.set(key, serialized, this.backendTtlSeconds).catch((error) => {
          logger.warn("Backend set failed", { errorName: errorName(error) });
        });
      } catch (error) {
        logger.warn("Cache value could not be serialized", {
          errorName: errorName(error),
        });
      }
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
          const serialized = serializeFileCacheEntry(entry);
          // Update request-scoped cache so subsequent reads in same request see the new value
          setInRequestCache(key, serialized);
          await backend.set(key, serialized, this.backendTtlSeconds);
        } catch (error) {
          logger.debug("Backend set failed; value remains uncached", {
            errorName: errorName(error),
          });
        }
      },
      { "cache.backend": backend.type, "cache.size": size },
    );
  }

  /** Write to fallback memory cache with size check and eviction. */
  private setToFallback<T>(key: string, entry: CacheEntry<T>, size: number): void {
    if (size > this.options.maxMemory) {
      logger.warn("Value too large for fallback cache", {
        size,
        maxMemory: this.options.maxMemory,
      });
      return;
    }

    const existing = this.fallbackCache.get(key);
    if (existing) {
      this.fallbackMemoryUsed -= existing.size;
      this.fallbackCache.delete(key);
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
      { "cache.backend": this.getBackend()?.type ?? "memory" },
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
      logger.warn("Backend invalidation failed", { errorName: errorName(error) });
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
      { "cache.backend": this.getBackend()?.type ?? "memory" },
    );
  }

  deleteByPrefixAndSuffix(prefix: string, suffix: string): number {
    const count = this.clearLocalByPrefixAndSuffix(prefix, suffix);

    // Fire-and-forget backend deletion; failure logged at warn so operators can detect
    // persistent backend issues (e.g. Redis down) without needing debug logging enabled.
    // Note: prefix already includes "file:" from buildFileCacheKeyPrefix, don't add it again
    cacheBackend?.delByPattern?.(`${prefix}*:${suffix}`).catch((error) => {
      logger.warn("Backend invalidation failed", { errorName: errorName(error) });
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
      { "cache.backend": this.getBackend()?.type ?? "memory" },
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
