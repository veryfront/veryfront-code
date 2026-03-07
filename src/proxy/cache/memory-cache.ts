/**
 * In-Memory Token Cache - single-instance deployments.
 */

import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

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
    return withSpan(
      "cache.memory.get",
      async () => {
        const entry = this.cache.get(key);

        if (!entry) {
          this.misses++;
          return null;
        }

        if (Date.now() >= entry.expiresAt) {
          this.cache.delete(key);
          this.misses++;
          return null;
        }

        this.hits++;
        return entry;
      },
      { "cache.key": key },
    );
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.memory.set",
      async () => {
        if (this.cache.size >= this.maxSize) {
          const firstKey = this.cache.keys().next().value as string | undefined;
          if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, entry);
      },
      { "cache.key": key },
    );
  }

  delete(key: string): Promise<void> {
    return withSpan(
      "cache.memory.delete",
      async () => {
        this.cache.delete(key);
      },
      { "cache.key": key },
    );
  }

  clear(): Promise<void> {
    return withSpan("cache.memory.clear", async () => {
      this.cache.clear();
      this.hits = 0;
      this.misses = 0;
    });
  }

  has(key: string): Promise<boolean> {
    return withSpan(
      "cache.memory.has",
      async () => {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() >= entry.expiresAt) {
          this.cache.delete(key);
          return false;
        }

        return true;
      },
      { "cache.key": key },
    );
  }

  stats(): Promise<CacheStats> {
    return withSpan("cache.memory.stats", async () => ({
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      type: "memory",
    }));
  }

  close(): Promise<void> {
    return withSpan("cache.memory.close", async () => {
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.cache.clear();
    });
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
      proxyLogger.debug("[MemoryCache] Cleaned expired entries", { cleaned });
    }
  }
}
