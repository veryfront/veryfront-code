/**
 * In-Memory Token Cache - single-instance deployments.
 */

import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";
import {
  assertCacheOptionsObject,
  requireTokenCacheKey,
  snapshotTokenCacheEntry,
} from "./validation.ts";

const DEFAULT_MAX_SIZE = 1_000;
const DEFAULT_CLEANUP_INTERVAL = 60_000;
const MAX_CACHE_SIZE = 100_000;
const MAX_CLEANUP_INTERVAL = 24 * 60 * 60 * 1_000;

function readOwnOption(
  options: MemoryCacheOptions,
  key: keyof MemoryCacheOptions,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(options, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw new TypeError(`Memory cache option ${key} must be a data property`);
  }
  return descriptor.value;
}

function resolveIntegerOption(
  value: unknown,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new RangeError(
      `${label} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

export class MemoryCache implements TokenCache {
  private cache = new Map<string, TokenCacheEntry>();
  private hits = 0;
  private misses = 0;
  private readonly maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: MemoryCacheOptions = {}) {
    assertCacheOptionsObject(
      options,
      "Memory cache options",
      ["maxSize", "cleanupInterval"],
    );
    this.maxSize = resolveIntegerOption(
      readOwnOption(options, "maxSize"),
      DEFAULT_MAX_SIZE,
      "Memory cache maxSize",
      1,
      MAX_CACHE_SIZE,
    );
    const interval = resolveIntegerOption(
      readOwnOption(options, "cleanupInterval"),
      DEFAULT_CLEANUP_INTERVAL,
      "Memory cache cleanupInterval",
      0,
      MAX_CLEANUP_INTERVAL,
    );
    if (interval > 0) {
      this.cleanupTimer = setInterval(() => this.cleanup(), interval);
    }
  }

  get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      "cache.memory.get",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        const entry = this.cache.get(cacheKey);

        if (!entry) {
          this.misses++;
          return null;
        }

        if (Date.now() >= entry.expiresAt) {
          this.cache.delete(cacheKey);
          this.misses++;
          return null;
        }

        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, entry);
        this.hits++;
        return entry;
      },
    );
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.memory.set",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        const cachedEntry = snapshotTokenCacheEntry(entry);
        if (Date.now() >= cachedEntry.expiresAt) {
          this.cache.delete(cacheKey);
          return;
        }
        if (!this.cache.has(cacheKey) && this.cache.size >= this.maxSize) {
          this.cleanup();
          const firstKey = this.cache.keys().next().value as string | undefined;
          if (this.cache.size >= this.maxSize && firstKey) {
            this.cache.delete(firstKey);
          }
        }

        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cachedEntry);
      },
    );
  }

  delete(key: string): Promise<void> {
    return withSpan(
      "cache.memory.delete",
      async () => {
        this.assertOpen();
        this.cache.delete(requireTokenCacheKey(key));
      },
    );
  }

  clear(): Promise<void> {
    return withSpan("cache.memory.clear", async () => {
      this.assertOpen();
      this.cache.clear();
      this.hits = 0;
      this.misses = 0;
    });
  }

  has(key: string): Promise<boolean> {
    return withSpan(
      "cache.memory.has",
      async () => {
        this.assertOpen();
        const cacheKey = requireTokenCacheKey(key);
        const entry = this.cache.get(cacheKey);
        if (!entry) return false;

        if (Date.now() >= entry.expiresAt) {
          this.cache.delete(cacheKey);
          return false;
        }

        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, entry);
        return true;
      },
    );
  }

  stats(): Promise<CacheStats> {
    return withSpan("cache.memory.stats", async () => {
      this.assertOpen();
      return {
        hits: this.hits,
        misses: this.misses,
        size: this.cache.size,
        type: "memory",
      };
    });
  }

  close(): Promise<void> {
    return withSpan("cache.memory.close", async () => {
      if (this.closed) return;
      this.closed = true;
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
      this.cache.clear();
    });
  }

  private cleanup(): void {
    if (this.closed) return;
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

  private assertOpen(): void {
    if (this.closed) throw new Error("Memory cache is closed");
  }
}
