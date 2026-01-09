/**
 * In-Memory Token Cache - single-instance deployments.
 */

import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_CLEANUP_INTERVAL = 60_000;

export class MemoryCache implements TokenCache {
  private cache = new Map<string, TokenCacheEntry>();
  private hits = 0;
  private misses = 0;
  private maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    const interval = options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
  }

  get(key: string): Promise<TokenCacheEntry | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return Promise.resolve(null);
    }

    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return Promise.resolve(null);
    }

    this.hits++;
    return Promise.resolve(entry);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, entry);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.cache.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return Promise.resolve(false);

    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return Promise.resolve(false);
    }

    return Promise.resolve(true);
  }

  stats(): Promise<CacheStats> {
    return Promise.resolve({
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      type: "memory",
    });
  }

  close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
    return Promise.resolve();
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[MemoryCache] Cleaned ${cleaned} expired entries`);
    }
  }
}
