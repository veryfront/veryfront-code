import { logger } from "@veryfront/utils";
import type { CacheEntry, CacheStats, FileCacheOptions } from "./types.ts";
import { estimateSize } from "./size-estimator.ts";
import { LRUTracker } from "./lru-tracker.ts";
import { EvictionManager } from "@veryfront/utils/cache/eviction/eviction-manager.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "../../../../core/utils/redis-client.ts";
import { buildRedisFileCacheKey } from "../../../../core/cache/keys.ts";

/** Default maximum memory for file cache (100 MB) */
const DEFAULT_MAX_MEMORY_BYTES = 100 * 1024 * 1024;

/** Default TTL for cache entries (1 minute) */
const DEFAULT_CACHE_TTL_MS = 60_000;

/** Default maximum number of cache entries */
const DEFAULT_MAX_ENTRIES = 1000;

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

export class FileCache {
  private cache: Map<string, CacheEntry<unknown>>;
  private lruTracker: LRUTracker;
  private evictionManager: EvictionManager<CacheEntry<unknown>>;
  private options: Required<FileCacheOptions>;
  private hits: number = 0;
  private misses: number = 0;

  constructor(options: FileCacheOptions = {}) {
    this.options = {
      enabled: true,
      ttl: DEFAULT_CACHE_TTL_MS,
      maxSize: DEFAULT_MAX_ENTRIES,
      maxMemory: DEFAULT_MAX_MEMORY_BYTES,
      ...options,
    };

    this.cache = new Map();
    this.lruTracker = new LRUTracker();
    this.evictionManager = new EvictionManager<CacheEntry<unknown>>({
      onEvict: (key: string, _value: unknown) => {
        logger.debug("[FileCache] Evicted LRU entry", { key });
      },
      loggerContext: "FileCache",
    });

    logger.debug("[FileCache] Initialized", this.options);
  }

  get<T>(key: string): T | undefined {
    if (!this.options.enabled) {
      this.misses++;
      return undefined;
    }

    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (this.evictionManager.isExpired(entry, this.options.ttl)) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    this.lruTracker.update(key);
    this.hits++;

    return entry.value;
  }

  /**
   * Async get that checks Redis after memory miss.
   * Use this when Redis caching is enabled for cross-pod cache sharing.
   */
  async getAsync<T>(key: string): Promise<T | undefined> {
    if (!this.options.enabled) {
      this.misses++;
      return undefined;
    }

    // Try memory first
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;

    if (entry) {
      if (this.evictionManager.isExpired(entry, this.options.ttl)) {
        this.delete(key);
      } else {
        this.lruTracker.update(key);
        this.hits++;
        return entry.value;
      }
    }

    // Try Redis if enabled
    if (redisEnabled && redisClient) {
      const redisEntry = await getFromRedis<T>(key);
      if (redisEntry) {
        // Check if expired
        const now = Date.now();
        if (now - redisEntry.timestamp < this.options.ttl) {
          // Store in memory for faster subsequent access
          this.cache.set(key, redisEntry as CacheEntry<unknown>);
          this.lruTracker.update(key);
          this.hits++;
          logger.debug("[FileCache] Redis cache hit", { key });
          return redisEntry.value;
        }
      }
    }

    this.misses++;
    return undefined;
  }

  set<T>(key: string, value: T): void {
    if (!this.options.enabled) {
      return;
    }

    const size = estimateSize(value);

    if (size > this.options.maxMemory) {
      logger.warn("[FileCache] Value too large to cache", {
        key,
        size,
        maxMemory: this.options.maxMemory,
      });
      return;
    }

    this.evictionManager.evictIfNeeded(
      this.cache,
      this.lruTracker,
      size,
      this.options.maxSize,
      this.options.maxMemory,
    );

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      size,
    };

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.lruTracker.update(key);

    // Fire-and-forget Redis write if enabled
    if (redisEnabled && redisClient) {
      setInRedis(key, entry).catch(() => {});
    }

    logger.debug("[FileCache] Cached", { key, size, entries: this.cache.size });
  }

  /**
   * Async set that writes through to Redis.
   * Use this when you need to ensure Redis write completes.
   */
  async setAsync<T>(key: string, value: T): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    const size = estimateSize(value);

    if (size > this.options.maxMemory) {
      logger.warn("[FileCache] Value too large to cache", {
        key,
        size,
        maxMemory: this.options.maxMemory,
      });
      return;
    }

    this.evictionManager.evictIfNeeded(
      this.cache,
      this.lruTracker,
      size,
      this.options.maxSize,
      this.options.maxMemory,
    );

    const entry: CacheEntry<T> = {
      value,
      timestamp: Date.now(),
      size,
    };

    this.cache.set(key, entry as CacheEntry<unknown>);
    this.lruTracker.update(key);

    // Write to Redis if enabled
    if (redisEnabled && redisClient) {
      await setInRedis(key, entry);
    }

    logger.debug("[FileCache] Cached", { key, size, entries: this.cache.size });
  }

  has(key: string): boolean {
    if (!this.options.enabled) {
      return false;
    }

    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    if (this.evictionManager.isExpired(entry, this.options.ttl)) {
      this.delete(key);
      return false;
    }

    return true;
  }

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.lruTracker.remove(key);
    }
    return deleted;
  }

  deleteByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.lruTracker.remove(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug("[FileCache] Deleted by prefix (memory)", { prefix, count });
    }

    // Fire-and-forget Redis deletion for cross-pod consistency
    if (redisEnabled && redisClient) {
      deleteFromRedisByPattern(`${prefix}*`).catch((error) => {
        logger.warn("[FileCache] Redis deleteByPrefix failed", { prefix, error });
      });
    }

    return count;
  }

  /**
   * Async version that awaits Redis deletion.
   * Use this when you need to ensure Redis cache is cleared before proceeding,
   * such as during invalidation before triggering browser reload.
   */
  async deleteByPrefixAsync(prefix: string): Promise<number> {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        this.lruTracker.remove(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug("[FileCache] Deleted by prefix (memory)", { prefix, count });
    }

    // Await Redis deletion to ensure cross-pod cache consistency
    if (redisEnabled && redisClient) {
      try {
        const redisCount = await deleteFromRedisByPattern(`${prefix}*`);
        logger.debug("[FileCache] Deleted by prefix (Redis)", { prefix, redisCount });
      } catch (error) {
        logger.warn("[FileCache] Redis deleteByPrefixAsync failed", { prefix, error });
      }
    }

    return count;
  }

  deleteByPrefixAndSuffix(prefix: string, suffix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key.endsWith(`:${suffix}`)) {
        this.cache.delete(key);
        this.lruTracker.remove(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug("[FileCache] Deleted by prefix+suffix (memory)", { prefix, suffix, count });
    }

    // Fire-and-forget Redis deletion for cross-pod consistency
    // Pattern: prefix*:suffix (e.g., file:content:*:components/sections/HeroSection.tsx)
    if (redisEnabled && redisClient) {
      deleteFromRedisByPattern(`${prefix}*:${suffix}`).catch((error) => {
        logger.warn("[FileCache] Redis deleteByPrefixAndSuffix failed", { prefix, suffix, error });
      });
    }

    return count;
  }

  /**
   * Async version that awaits Redis deletion.
   * Use this when you need to ensure Redis cache is cleared before proceeding,
   * such as during selective invalidation before triggering browser reload.
   */
  async deleteByPrefixAndSuffixAsync(prefix: string, suffix: string): Promise<number> {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key.endsWith(`:${suffix}`)) {
        this.cache.delete(key);
        this.lruTracker.remove(key);
        count++;
      }
    }
    if (count > 0) {
      logger.debug("[FileCache] Deleted by prefix+suffix (memory)", { prefix, suffix, count });
    }

    // Await Redis deletion to ensure cross-pod cache consistency
    // Pattern: prefix*:suffix (e.g., file:content:*:components/sections/HeroSection.tsx)
    if (redisEnabled && redisClient) {
      try {
        const redisCount = await deleteFromRedisByPattern(`${prefix}*:${suffix}`);
        logger.debug("[FileCache] Deleted by prefix+suffix (Redis)", {
          prefix,
          suffix,
          redisCount,
        });
      } catch (error) {
        logger.warn("[FileCache] Redis deleteByPrefixAndSuffixAsync failed", {
          prefix,
          suffix,
          error,
        });
      }
    }

    return count;
  }

  clear(): void {
    this.cache.clear();
    this.lruTracker.clear();
    this.hits = 0;
    this.misses = 0;
    logger.debug("[FileCache] Cleared");
  }

  stats(): CacheStats & { redisEnabled: boolean } {
    const memoryUsed = Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      size: this.cache.size,
      memoryUsed,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      redisEnabled,
    };
  }

  evictExpired(): number {
    const evicted = this.evictionManager.evictExpired(
      this.cache,
      this.lruTracker,
      this.options.ttl,
    );
    if (evicted > 0) {
      logger.debug("[FileCache] Evicted expired entries", { evicted, remaining: this.cache.size });
    }
    return evicted;
  }
}
