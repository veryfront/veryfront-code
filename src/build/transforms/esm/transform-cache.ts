/**
 * Transform Cache with Redis Support
 *
 * Caches ESM-transformed code with support for:
 * - In-memory cache (default, with LRU eviction)
 * - Redis cache (shared across pods, reduces duplicate transforms)
 */

import { registerCache } from "@veryfront/core/memory/index.ts";
import { logger } from "@veryfront/utils/logger/logger.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "@veryfront/utils/redis-client.ts";
import { unrefTimer } from "@veryfront/platform/compat/process.ts";
import { getDisableLruIntervalEnv } from "@veryfront/core/config/env.ts";

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TTL_SECONDS = 300; // 5 minutes for Redis
const MAX_ENTRIES = 2_000;
const CLEANUP_INTERVAL_MS = 60000; // 1 minute
const REDIS_KEY_PREFIX = "veryfront:transform:";

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
  expiresAt: number;
}

// In-memory cache (used as primary or fallback)
const memoryCache = new Map<string, TransformCacheEntry>();

// Redis state
let redisEnabled = false;
let redisClient: RedisClient | null = null;
let redisInitialized = false;
let redisInitPromise: Promise<void> | null = null;

// Register with memory profiler
registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: memoryCache.size,
  maxEntries: MAX_ENTRIES,
  redisEnabled,
}));

// Periodic cleanup of expired entries to prevent memory bloat
let cleanupInterval: ReturnType<typeof setInterval> | undefined;

function shouldDisableInterval(): boolean {
  if ((globalThis as Record<string, unknown>).__vfDisableLruInterval === true) {
    return true;
  }
  return getDisableLruIntervalEnv();
}

function startPeriodicCleanup(): void {
  if (shouldDisableInterval()) {
    return;
  }
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryCache) {
      if (entry.expiresAt <= now) {
        memoryCache.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Unref the timer so it doesn't prevent process exit or cause test leaks
  unrefTimer(cleanupInterval);
}

// Start cleanup on module load
startPeriodicCleanup();

export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
}

/**
 * Initialize Redis for transform cache.
 * Call this at startup if you want to enable Redis caching.
 */
export async function initializeRedisCache(): Promise<boolean> {
  if (redisInitialized) {
    return redisEnabled;
  }

  if (redisInitPromise) {
    await redisInitPromise;
    return redisEnabled;
  }

  redisInitPromise = (async () => {
    if (!isRedisConfigured()) {
      logger.debug("[TransformCache] Redis not configured, using memory cache");
      redisInitialized = true;
      return;
    }

    try {
      redisClient = await getRedisClient();
      redisEnabled = true;
      redisInitialized = true;
      logger.info("[TransformCache] Redis cache enabled");
    } catch (error) {
      logger.warn("[TransformCache] Redis unavailable, falling back to memory cache", { error });
      redisEnabled = false;
      redisInitialized = true;
    }
  })();

  await redisInitPromise;
  redisInitPromise = null;
  return redisEnabled;
}

/**
 * Check if Redis caching is enabled.
 */
export function isRedisCacheEnabled(): boolean {
  return redisEnabled && redisClient !== null;
}

/**
 * Generate a content-addressable cache key for transforms.
 * Content hash provides automatic invalidation and cross-project deduplication.
 *
 * Key format: {filePath}:{contentHash}:{ssr|browser}
 */
export function generateCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
): string {
  const ssrKey = ssr ? "ssr" : "browser";
  return `${filePath}:${contentHash}:${ssrKey}`;
}

function redisKey(key: string): string {
  return `${REDIS_KEY_PREFIX}${key}`;
}

/**
 * Get cached transform, checking Redis first (if enabled), then memory.
 */
export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  // Try Redis first if enabled
  if (redisEnabled && redisClient) {
    try {
      const raw = await redisClient.get(redisKey(key));
      if (raw) {
        const entry = JSON.parse(raw) as TransformCacheEntry;
        // Also store in memory cache for faster subsequent access
        memoryCache.set(key, entry);
        return entry;
      }
    } catch (error) {
      logger.debug("[TransformCache] Redis get failed, trying memory", { key, error });
    }
  }

  // Fall back to memory cache
  return getCachedTransform(key);
}

/**
 * Get cached transform from memory (synchronous).
 */
export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  const entry = memoryCache.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return undefined;
  }

  return entry;
}

/**
 * Set cached transform in both Redis (if enabled) and memory.
 */
export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttl: number = DEFAULT_TTL_MS,
): Promise<void> {
  const now = Date.now();
  const entry: TransformCacheEntry = {
    code,
    hash,
    timestamp: now,
    expiresAt: now + Math.max(1, ttl),
  };

  // Store in memory cache
  memoryCache.set(key, entry);

  if (memoryCache.size > MAX_ENTRIES) {
    pruneMemoryCache();
  }

  // Store in Redis if enabled
  if (redisEnabled && redisClient) {
    try {
      const ttlSeconds = Math.ceil(ttl / 1000);
      await redisClient.set(redisKey(key), JSON.stringify(entry), {
        EX: ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS,
      });
    } catch (error) {
      logger.debug("[TransformCache] Redis set failed", { key, error });
    }
  }
}

/**
 * Set cached transform (synchronous, memory only).
 * Use setCachedTransformAsync for Redis support.
 */
export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttl: number = DEFAULT_TTL_MS,
): void {
  const now = Date.now();
  memoryCache.set(key, {
    code,
    hash,
    timestamp: now,
    expiresAt: now + Math.max(1, ttl),
  });

  if (memoryCache.size > MAX_ENTRIES) {
    pruneMemoryCache();
  }

  // Fire-and-forget Redis set if enabled
  if (redisEnabled && redisClient) {
    const entry: TransformCacheEntry = {
      code,
      hash,
      timestamp: now,
      expiresAt: now + Math.max(1, ttl),
    };
    const ttlSeconds = Math.ceil(ttl / 1000);
    redisClient
      .set(redisKey(key), JSON.stringify(entry), {
        EX: ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS,
      })
      .catch((error) => {
        logger.debug("[TransformCache] Redis set failed", { key, error });
      });
  }
}

export function destroyTransformCache(): void {
  memoryCache.clear();
}

function pruneMemoryCache(): void {
  const entries = Array.from(memoryCache.entries()).sort(
    ([, a], [, b]) => a.timestamp - b.timestamp,
  );

  const excess = memoryCache.size - MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    memoryCache.delete(key);
  }
}

/**
 * Get cache statistics.
 */
export function getTransformCacheStats(): {
  memoryEntries: number;
  maxEntries: number;
  redisEnabled: boolean;
} {
  return {
    memoryEntries: memoryCache.size,
    maxEntries: MAX_ENTRIES,
    redisEnabled,
  };
}
