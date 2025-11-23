import { logger } from "@veryfront/utils";
import type { CacheEntry, CacheStats, FileCacheOptions } from "./types.ts";
import { estimateSize } from "./size-estimator.ts";
import { LRUTracker } from "./lru-tracker.ts";
import { EvictionManager } from "@veryfront/utils/cache/eviction/eviction-manager.ts";

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
      ttl: 60_000, // 1 minute default
      maxSize: 1000,
      maxMemory: 100 * 1024 * 1024, // 100 MB default
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

  clear(): void {
    this.cache.clear();
    this.lruTracker.clear();
    this.hits = 0;
    this.misses = 0;
    logger.debug("[FileCache] Cleared");
  }

  stats(): CacheStats {
    const memoryUsed = Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      size: this.cache.size,
      memoryUsed,
      hits: this.hits,
      misses: this.misses,
      hitRate,
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
