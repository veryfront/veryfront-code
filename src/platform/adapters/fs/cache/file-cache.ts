/**
 * File Cache - Redis-First Architecture
 *
 * Optimized for ephemeral pods with limited memory.
 *
 * Strategy:
 * - Redis: Primary storage for file content (shared across pods)
 * - Memory: Small fallback for local development without Redis
 */

import { logger } from "@veryfront/utils";
import type { CacheEntry, CacheStats, FileCacheOptions } from "./types.ts";
import { estimateSize } from "./size-estimator.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "../../../../core/utils/redis-client.ts";
import { buildRedisFileCacheKey } from "../../../../core/cache/keys.ts";

/** Default TTL for cache entries (1 minute) */
const DEFAULT_CACHE_TTL_MS = 60_000;

/** Fallback cache max entries (small, for local dev) */
const FALLBACK_MAX_ENTRIES = 200;

/** Fallback cache max memory (10 MB, for local dev) */
const FALLBACK_MAX_MEMORY_BYTES = 10 * 1024 * 1024;

const REDIS_TTL_SECONDS = 300; // 5 minutes

// Shared Redis state across all FileCache instances
let redisEnabled = false;
let redisClient: RedisClient | null = null;
let redisInitialized = false;
let redisInitPromise: Promise<void> | null = null;

/**
 * Initialize Redis for file cache.
 * Call this at startup if you want to enable Redis caching.
 */
export async function initializeFileCacheRedis(): Promise<boolean> {
  if (redisInitialized) {
    return redisEnabled;
  }

  if (redisInitPromise) {
    await redisInitPromise;
    return redisEnabled;
  }

  redisInitPromise = (async () => {
    if (!isRedisConfigured()) {
      logger.debug("[FileCache] Redis not configured, using memory cache");
      redisInitialized = true;
      return;
    }

    try {
      redisClient = await getRedisClient();
      redisEnabled = true;
      redisInitialized = true;
      logger.debug("[FileCache] Redis cache enabled");
    } catch (error) {
      logger.warn("[FileCache] Redis unavailable, falling back to memory cache", { error });
      redisEnabled = false;
      redisInitialized = true;
    }
  })();

  await redisInitPromise;
  redisInitPromise = null;
  return redisEnabled;
}

/**
 * Check if Redis caching is enabled for file cache.
 */
export function isFileCacheRedisEnabled(): boolean {
  return redisEnabled && redisClient !== null;
}

function redisKey(key: string): string {
  return buildRedisFileCacheKey(key);
}

/**
 * Get cached entry from Redis.
 */
async function getFromRedis<T>(key: string): Promise<CacheEntry<T> | null> {
  if (!redisEnabled || !redisClient) return null;

  try {
    const raw = await redisClient.get(redisKey(key));
    if (raw) {
      return JSON.parse(raw) as CacheEntry<T>;
    }
    return null;
  } catch (error) {
    logger.debug("[FileCache] Redis get failed", { key, error });
    return null;
  }
}

/**
 * Store cached entry in Redis.
 */
async function setInRedis<T>(key: string, entry: CacheEntry<T>): Promise<void> {
  if (!redisEnabled || !redisClient) return;

  try {
    await redisClient.set(redisKey(key), JSON.stringify(entry), { EX: REDIS_TTL_SECONDS });
  } catch (error) {
    logger.debug("[FileCache] Redis set failed", { key, error });
  }
}

/**
 * Delete keys matching a pattern from Redis using SCAN.
 * Uses SCAN to avoid blocking Redis with KEYS command on large datasets.
 */
async function deleteFromRedisByPattern(pattern: string): Promise<number> {
  if (!redisEnabled || !redisClient) return 0;

  try {
    const fullPattern = redisKey(pattern);
    let cursor = 0;
    let deletedCount = 0;
    const keysToDelete: string[] = [];

    // Use SCAN to find matching keys (non-blocking)
    do {
      const result = await redisClient.scan(cursor, { MATCH: fullPattern, COUNT: 100 });
      cursor = result.cursor;
      if (result.keys.length > 0) {
        keysToDelete.push(...result.keys);
      }
    } while (cursor !== 0);

    // Delete found keys in batches
    if (keysToDelete.length > 0) {
      await redisClient.del(keysToDelete);
      deletedCount = keysToDelete.length;
      logger.debug("[FileCache] Deleted keys from Redis by pattern", {
        pattern: fullPattern,
        count: deletedCount,
      });
    }

    return deletedCount;
  } catch (error) {
    logger.warn("[FileCache] Redis delete by pattern failed", { pattern, error });
    return 0;
  }
}

/**
 * FileCache - Redis-First with Small Fallback
 *
 * When Redis is available: Redis-only (no memory duplication)
 * When Redis unavailable: Small memory fallback for local dev
 */
export class FileCache {
  private fallbackCache: Map<string, CacheEntry<unknown>>;
  private fallbackMemoryUsed: number = 0;
  private options: Required<FileCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: FileCacheOptions = {}) {
    this.options = {
      enabled: true,
      ttl: DEFAULT_CACHE_TTL_MS,
      maxSize: FALLBACK_MAX_ENTRIES,
      maxMemory: FALLBACK_MAX_MEMORY_BYTES,
      ...options,
    };

    // Fallback cache only used when Redis is unavailable
    this.fallbackCache = new Map();

    const mode = redisEnabled ? "redis-only" : "fallback-memory";
    logger.debug("[FileCache] Initialized", { ...this.options, mode });
  }

  /**
   * Synchronous get - only checks fallback cache (for local dev without Redis).
   * In production with Redis, use getAsync instead.
   */
  get<T>(key: string): T | undefined {
    if (!this.options.enabled) {
      this.misses++;
      return undefined;
    }

    // In Redis mode, sync get always misses - use getAsync
    if (redisEnabled) {
      this.misses++;
      return undefined;
    }

    // Fallback mode: check memory cache
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
   * Async get - checks Redis (primary) or fallback memory cache.
   */
  async getAsync<T>(key: string): Promise<T | undefined> {
    if (!this.options.enabled) {
      this.misses++;
      return undefined;
    }

    // Redis-only mode: only check Redis
    if (redisEnabled && redisClient) {
      const redisEntry = await getFromRedis<T>(key);
      if (redisEntry) {
        const now = Date.now();
        if (now - redisEntry.timestamp < this.options.ttl) {
          this.hits++;
          return redisEntry.value;
        }
      }
      this.misses++;
      return undefined;
    }

    // Fallback mode: check memory cache
    return this.get<T>(key);
  }

  /**
   * Synchronous set - only writes to fallback cache (for local dev without Redis).
   * In production with Redis, use setAsync instead.
   */
  set<T>(key: string, value: T): void {
    if (!this.options.enabled) {
      return;
    }

    const size = estimateSize(value);

    // In Redis mode, fire-and-forget to Redis
    if (redisEnabled && redisClient) {
      const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };
      setInRedis(key, entry).catch(() => {});
      return;
    }

    // Fallback mode: write to memory cache
    if (size > this.options.maxMemory) {
      logger.warn("[FileCache] Value too large for fallback cache", { key, size });
      return;
    }

    this.evictFallbackIfNeeded(size);

    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };
    this.fallbackCache.set(key, entry as CacheEntry<unknown>);
    this.fallbackMemoryUsed += size;
  }

  /**
   * Async set - writes to Redis (primary) or fallback memory cache.
   */
  async setAsync<T>(key: string, value: T): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    const size = estimateSize(value);
    const entry: CacheEntry<T> = { value, timestamp: Date.now(), size };

    // Redis-only mode: write to Redis
    if (redisEnabled && redisClient) {
      await setInRedis(key, entry);
      return;
    }

    // Fallback mode: write to memory cache
    if (size > this.options.maxMemory) {
      logger.warn("[FileCache] Value too large for fallback cache", { key, size });
      return;
    }

    this.evictFallbackIfNeeded(size);
    this.fallbackCache.set(key, entry as CacheEntry<unknown>);
    this.fallbackMemoryUsed += size;
  }

  has(key: string): boolean {
    if (!this.options.enabled) return false;
    if (redisEnabled) return false; // Use hasAsync for Redis mode

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
    if (entry) {
      this.fallbackMemoryUsed -= entry.size;
    }
    return this.fallbackCache.delete(key);
  }

  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of [...this.fallbackCache.keys()]) {
      if (key.startsWith(prefix)) {
        const entry = this.fallbackCache.get(key);
        if (entry) this.fallbackMemoryUsed -= entry.size;
        this.fallbackCache.delete(key);
        count++;
      }
    }

    // Fire-and-forget Redis deletion
    if (redisEnabled && redisClient) {
      deleteFromRedisByPattern(`${prefix}*`).catch(() => {});
    }

    return count;
  }

  async deleteByPrefixAsync(prefix: string): Promise<number> {
    const count = this.deleteByPrefix(prefix);

    // Await Redis deletion for cross-pod consistency
    if (redisEnabled && redisClient) {
      await deleteFromRedisByPattern(`${prefix}*`);
    }

    return count;
  }

  deleteByPrefixAndSuffix(prefix: string, suffix: string): number {
    let count = 0;
    for (const key of [...this.fallbackCache.keys()]) {
      if (key.startsWith(prefix) && key.endsWith(`:${suffix}`)) {
        const entry = this.fallbackCache.get(key);
        if (entry) this.fallbackMemoryUsed -= entry.size;
        this.fallbackCache.delete(key);
        count++;
      }
    }

    // Fire-and-forget Redis deletion
    if (redisEnabled && redisClient) {
      deleteFromRedisByPattern(`${prefix}*:${suffix}`).catch(() => {});
    }

    return count;
  }

  async deleteByPrefixAndSuffixAsync(prefix: string, suffix: string): Promise<number> {
    const count = this.deleteByPrefixAndSuffix(prefix, suffix);

    // Await Redis deletion for cross-pod consistency
    if (redisEnabled && redisClient) {
      await deleteFromRedisByPattern(`${prefix}*:${suffix}`);
    }

    return count;
  }

  clear(): void {
    this.fallbackCache.clear();
    this.fallbackMemoryUsed = 0;
    this.hits = 0;
    this.misses = 0;
  }

  stats(): CacheStats & { redisEnabled: boolean; mode: string } {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      size: this.fallbackCache.size,
      memoryUsed: this.fallbackMemoryUsed,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      redisEnabled,
      mode: redisEnabled ? "redis-only" : "fallback-memory",
    };
  }

  evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.fallbackCache) {
      if (now - entry.timestamp > this.options.ttl) {
        this.fallbackMemoryUsed -= entry.size;
        this.fallbackCache.delete(key);
        evicted++;
      }
    }

    return evicted;
  }

  private evictFallbackIfNeeded(newSize: number): void {
    // Evict by count
    while (this.fallbackCache.size >= this.options.maxSize) {
      const oldest = this.fallbackCache.keys().next().value;
      if (oldest) {
        const entry = this.fallbackCache.get(oldest);
        if (entry) this.fallbackMemoryUsed -= entry.size;
        this.fallbackCache.delete(oldest);
      } else break;
    }

    // Evict by memory
    while (
      this.fallbackMemoryUsed + newSize > this.options.maxMemory && this.fallbackCache.size > 0
    ) {
      const oldest = this.fallbackCache.keys().next().value;
      if (oldest) {
        const entry = this.fallbackCache.get(oldest);
        if (entry) this.fallbackMemoryUsed -= entry.size;
        this.fallbackCache.delete(oldest);
      } else break;
    }
  }
}
