/**
 * In-Memory Token Cache
 *
 * Fast in-memory cache with automatic expiration cleanup.
 * Suitable for single-instance deployments or development.
 */

import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";

const DEFAULT_MAX_SIZE = 1000;
const DEFAULT_CLEANUP_INTERVAL = 60_000; // 1 minute

export class MemoryCache implements TokenCache {
  private cache = new Map<string, TokenCacheEntry>();
  private hits = 0;
  private misses = 0;
  private maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;

    // Start cleanup timer
    const interval = options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    this.cleanupTimer = setInterval(() => this.cleanup(), interval);
  }

  async get(key: string): Promise<TokenCacheEntry | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry;
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    // Enforce max size (LRU-like: remove oldest entries)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check if expired
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  async stats(): Promise<CacheStats> {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      type: "memory",
    };
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  /**
   * Remove expired entries.
   */
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
