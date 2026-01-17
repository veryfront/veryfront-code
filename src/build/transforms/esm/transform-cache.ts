/**
 * Transform Cache - Redis-First Architecture
 *
 * Caches ESM-transformed code with Redis as primary storage.
 * Optimized for ephemeral pods with limited memory.
 *
 * Strategy:
 * - Redis: Primary storage for transformed code (shared across pods)
 * - Memory: Disabled by default to conserve pod memory
 *
 * For local development without Redis, falls back to memory cache.
 */

import { registerCache } from "@veryfront/core/memory/index.ts";
import { logger } from "@veryfront/utils/logger/logger.ts";
import {
  getRedisClient,
  isRedisConfigured,
  type RedisClient,
} from "@veryfront/utils/redis-client.ts";
import { buildRedisTransformKey, buildTransformCacheKey } from "../../../core/cache/keys.ts";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes for Redis

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
}

// Fallback memory cache (only used when Redis is not available)
const fallbackCache = new Map<string, TransformCacheEntry>();
const FALLBACK_MAX_ENTRIES = 500; // Small fallback for local dev

// Redis state
let redisEnabled = false;
let redisClient: RedisClient | null = null;
let redisInitialized = false;
let redisInitPromise: Promise<void> | null = null;

// Register with memory profiler
registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: fallbackCache.size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  redisEnabled,
  mode: redisEnabled ? "redis-only" : "fallback-memory",
}));

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
      logger.debug("[TransformCache] Redis not configured, using fallback memory cache");
      redisInitialized = true;
      return;
    }

    try {
      redisClient = await getRedisClient();
      redisEnabled = true;
      redisInitialized = true;
      logger.info("[TransformCache] Redis-only mode enabled");
    } catch (error) {
      logger.warn("[TransformCache] Redis unavailable, using fallback memory cache", { error });
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
 * Key format: {filePath}:{contentHash}:{ssr|browser}[:studio]
 */
export function generateCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
): string {
  return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed);
}

function redisKey(key: string): string {
  return buildRedisTransformKey(key);
}

/**
 * Get cached transform from Redis (primary) or fallback memory cache.
 */
export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  // Redis-only mode: only check Redis
  if (redisEnabled && redisClient) {
    try {
      const raw = await redisClient.get(redisKey(key));
      if (raw) {
        return JSON.parse(raw) as TransformCacheEntry;
      }
      return undefined;
    } catch (error) {
      logger.debug("[TransformCache] Redis get failed", { key, error });
      return undefined;
    }
  }

  // Fallback mode: use memory cache (local dev without Redis)
  return getCachedTransform(key);
}

/**
 * Get cached transform from fallback memory cache (synchronous).
 * Only used when Redis is not available.
 */
export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  // In Redis mode, always return undefined for sync calls
  // Callers should use getCachedTransformAsync instead
  if (redisEnabled) {
    return undefined;
  }

  return fallbackCache.get(key);
}

/**
 * Set cached transform in Redis (primary) or fallback memory cache.
 */
export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const entry: TransformCacheEntry = {
    code,
    hash,
    timestamp: Date.now(),
  };

  // Redis-only mode: only write to Redis
  if (redisEnabled && redisClient) {
    try {
      await redisClient.set(redisKey(key), JSON.stringify(entry), {
        EX: ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS,
      });
    } catch (error) {
      logger.debug("[TransformCache] Redis set failed", { key, error });
    }
    return;
  }

  // Fallback mode: use memory cache (local dev without Redis)
  fallbackCache.set(key, entry);
  if (fallbackCache.size > FALLBACK_MAX_ENTRIES) {
    pruneFallbackCache();
  }
}

/**
 * Set cached transform (fire-and-forget).
 * Writes to Redis if enabled, otherwise to fallback memory cache.
 */
export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  const entry: TransformCacheEntry = {
    code,
    hash,
    timestamp: Date.now(),
  };

  // Redis-only mode: fire-and-forget write to Redis
  if (redisEnabled && redisClient) {
    redisClient
      .set(redisKey(key), JSON.stringify(entry), {
        EX: ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS,
      })
      .catch((error) => {
        logger.debug("[TransformCache] Redis set failed", { key, error });
      });
    return;
  }

  // Fallback mode: use memory cache (local dev without Redis)
  fallbackCache.set(key, entry);
  if (fallbackCache.size > FALLBACK_MAX_ENTRIES) {
    pruneFallbackCache();
  }
}

export function destroyTransformCache(): void {
  fallbackCache.clear();
}

function pruneFallbackCache(): void {
  const entries = Array.from(fallbackCache.entries()).sort(
    ([, a], [, b]) => a.timestamp - b.timestamp,
  );

  const excess = fallbackCache.size - FALLBACK_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    fallbackCache.delete(key);
  }
}

/**
 * Get cache statistics.
 */
export function getTransformCacheStats(): {
  fallbackEntries: number;
  maxFallbackEntries: number;
  redisEnabled: boolean;
  mode: string;
} {
  return {
    fallbackEntries: fallbackCache.size,
    maxFallbackEntries: FALLBACK_MAX_ENTRIES,
    redisEnabled,
    mode: redisEnabled ? "redis-only" : "fallback-memory",
  };
}
