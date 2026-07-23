/**
 * In-Memory Token Cache - single-instance deployments.
 */

import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.ts";
import { proxyLogger } from "../logger.ts";
import { withSpan } from "../tracing.ts";

const DEFAULT_MAX_SIZE = 1_000;
const DEFAULT_CLEANUP_INTERVAL = 60_000;
const MAX_CONFIGURED_SIZE = 100_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_CACHE_KEY_LENGTH = 1_024;
const MAX_TOKEN_LENGTH = 65_536;
const MAX_PROJECT_SLUG_LENGTH = 1_024;

function requirePositiveInteger(name: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function requireCacheKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new TypeError("cache key must be a non-empty string");
  }
  if (key.length > MAX_CACHE_KEY_LENGTH) {
    throw new RangeError(`cache key must not exceed ${MAX_CACHE_KEY_LENGTH} characters`);
  }
}

function copyEntry(entry: TokenCacheEntry): TokenCacheEntry {
  if (typeof entry !== "object" || entry === null) {
    throw new TypeError("cache entry must be an object");
  }
  const token = entry.token;
  const expiresAt = entry.expiresAt;
  const scope = entry.scope;
  const projectSlug = entry.projectSlug;
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("cache entry token must be a non-empty string");
  }
  if (token.length > MAX_TOKEN_LENGTH) {
    throw new RangeError(`cache entry token must not exceed ${MAX_TOKEN_LENGTH} characters`);
  }
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
    throw new TypeError("cache entry expiresAt must be a non-negative safe integer");
  }
  if (scope !== "preview" && scope !== "production") {
    throw new TypeError('cache entry scope must be "preview" or "production"');
  }
  if (projectSlug !== undefined) {
    if (typeof projectSlug !== "string" || projectSlug.length === 0) {
      throw new TypeError("cache entry projectSlug must be a non-empty string when provided");
    }
    if (projectSlug.length > MAX_PROJECT_SLUG_LENGTH) {
      throw new RangeError(
        `cache entry projectSlug must not exceed ${MAX_PROJECT_SLUG_LENGTH} characters`,
      );
    }
  }
  return {
    token,
    expiresAt,
    scope,
    ...(projectSlug === undefined ? {} : { projectSlug }),
  };
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  const candidate = timer as unknown as { unref?: () => void };
  if (
    typeof candidate === "object" && candidate !== null && typeof candidate.unref === "function"
  ) {
    candidate.unref();
  }
}

/** Bounded, TTL-aware in-process token cache. */
export class MemoryCache implements TokenCache {
  private cache = new Map<string, TokenCacheEntry>();
  private hits = 0;
  private misses = 0;
  private maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  /** Create a cache and start its unreferenced expiry sweep timer. */
  constructor(options: MemoryCacheOptions = {}) {
    this.maxSize = requirePositiveInteger(
      "maxSize",
      options.maxSize ?? DEFAULT_MAX_SIZE,
      MAX_CONFIGURED_SIZE,
    );
    const interval = requirePositiveInteger(
      "cleanupInterval",
      options.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL,
      MAX_TIMER_DELAY_MS,
    );
    this.cleanupTimer = setInterval(() => this.cleanup(true), interval);
    unrefTimer(this.cleanupTimer);
  }

  /** Return an owned snapshot of a non-expired entry. */
  get(key: string): Promise<TokenCacheEntry | null> {
    return withSpan(
      "cache.memory.get",
      async () => {
        this.assertOpen();
        requireCacheKey(key);
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
        return copyEntry(entry);
      },
    );
  }

  /** Validate, copy, and store an entry. */
  set(key: string, entry: TokenCacheEntry): Promise<void> {
    return withSpan(
      "cache.memory.set",
      async () => {
        this.assertOpen();
        requireCacheKey(key);
        const ownedEntry = copyEntry(entry);

        if (ownedEntry.expiresAt <= Date.now()) {
          this.cache.delete(key);
          return;
        }

        this.cleanup(false);
        const replacing = this.cache.delete(key);
        if (!replacing && this.cache.size >= this.maxSize) {
          const firstKey = this.cache.keys().next().value as string | undefined;
          if (firstKey) this.cache.delete(firstKey);
        }

        this.cache.set(key, ownedEntry);
      },
    );
  }

  /** Delete one entry. */
  delete(key: string): Promise<void> {
    return withSpan(
      "cache.memory.delete",
      async () => {
        this.assertOpen();
        requireCacheKey(key);
        this.cache.delete(key);
      },
    );
  }

  /** Delete all entries and reset statistics. */
  clear(): Promise<void> {
    return withSpan("cache.memory.clear", async () => {
      this.assertOpen();
      this.cache.clear();
      this.hits = 0;
      this.misses = 0;
    });
  }

  /** Return whether a non-expired entry exists. */
  has(key: string): Promise<boolean> {
    return withSpan(
      "cache.memory.has",
      async () => {
        this.assertOpen();
        requireCacheKey(key);
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() >= entry.expiresAt) {
          this.cache.delete(key);
          return false;
        }

        return true;
      },
    );
  }

  /** Return statistics after removing expired entries. */
  stats(): Promise<CacheStats> {
    return withSpan("cache.memory.stats", async () => {
      this.assertOpen();
      this.cleanup(false);
      return {
        hits: this.hits,
        misses: this.misses,
        size: this.cache.size,
        type: "memory",
      };
    });
  }

  /** Stop cleanup and release all retained entries. */
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

  /** Reject operations after lifecycle shutdown. */
  private assertOpen(): void {
    if (this.closed) throw new Error("MemoryCache is closed");
  }

  /** Remove every expired entry. */
  private cleanup(logResult: boolean): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now >= entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (logResult && cleaned > 0) {
      proxyLogger.debug("[MemoryCache] Cleaned expired entries", { cleaned });
    }
  }
}
