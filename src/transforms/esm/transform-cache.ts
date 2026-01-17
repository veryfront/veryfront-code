/**
 * Transform Cache - Backend-Abstracted Architecture
 *
 * Caches ESM-transformed code with secure multi-tenant support.
 *
 * Strategy:
 * - Uses CacheBackend abstraction for backend selection
 * - API Mode (production): Uses veryfront-api for centralized cache
 * - Redis Mode (local dev/open source): Direct Redis access
 * - Memory Mode (fallback): In-memory cache
 *
 * Security: In production, renderer has no Redis credentials.
 * All cache access goes through the API which enforces tenant isolation.
 */

import { registerCache } from "@veryfront/utils/memory/index.ts";
import { logger } from "@veryfront/utils/logger/logger.ts";
import { buildTransformCacheKey } from "../../cache/keys.ts";
import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "../../cache/backend.ts";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
}

// Cache backend (initialized lazily)
let cacheBackend: CacheBackend | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

// Local fallback for sync operations (small, for local dev)
const localFallback = new Map<string, TransformCacheEntry>();
const FALLBACK_MAX_ENTRIES = 500;

// Register with memory profiler
registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: localFallback.size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: cacheBackend?.type ?? "uninitialized",
}));

/**
 * Initialize transform cache.
 * Uses CacheBackend factory to select appropriate backend.
 */
export async function initializeTransformCache(): Promise<boolean> {
  if (cacheInitialized) {
    return cacheBackend?.type !== "memory";
  }

  if (cacheInitPromise) {
    await cacheInitPromise;
    return cacheBackend?.type !== "memory";
  }

  cacheInitPromise = (async () => {
    try {
      cacheBackend = await CacheBackends.transform();
      cacheInitialized = true;
      logger.info("[TransformCache] Initialized", { backend: cacheBackend.type });
    } catch (error) {
      logger.warn("[TransformCache] Backend init failed, using memory", { error });
      cacheBackend = new MemoryCacheBackend(FALLBACK_MAX_ENTRIES);
      cacheInitialized = true;
    }
  })();

  await cacheInitPromise;
  cacheInitPromise = null;
  return cacheBackend?.type !== "memory";
}

/**
 * Check if distributed caching (API or Redis) is enabled.
 */
export function isDistributedCacheEnabled(): boolean {
  return cacheBackend !== null && cacheBackend.type !== "memory";
}

/** @deprecated Use initializeTransformCache instead */
export const initializeRedisCache = initializeTransformCache;

/** @deprecated Use isDistributedCacheEnabled instead */
export const isRedisCacheEnabled = isDistributedCacheEnabled;

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

/**
 * Get cached transform from backend or local fallback.
 */
export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  // Try backend first
  if (cacheBackend) {
    try {
      const raw = await cacheBackend.get(`transform:${key}`);
      if (raw) {
        return JSON.parse(raw) as TransformCacheEntry;
      }
    } catch (error) {
      logger.debug("[TransformCache] Backend get failed", { key, error });
    }
  }

  // Fall back to local memory for sync compatibility
  return localFallback.get(key);
}

/**
 * Get cached transform from local fallback (synchronous).
 * Only used when distributed cache is not available or for sync callers.
 */
export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  // In distributed mode, return undefined for sync calls
  // Callers should use getCachedTransformAsync instead
  if (cacheBackend && cacheBackend.type !== "memory") {
    return undefined;
  }

  return localFallback.get(key);
}

/**
 * Set cached transform in backend.
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

  // Write to backend
  if (cacheBackend) {
    try {
      const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
      await cacheBackend.set(`transform:${key}`, JSON.stringify(entry), ttl);
      return;
    } catch (error) {
      logger.debug("[TransformCache] Backend set failed", { key, error });
    }
  }

  // Fallback to local memory
  setLocalFallback(key, entry);
}

/**
 * Set cached transform (fire-and-forget).
 * Writes to backend or local fallback.
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

  // Fire-and-forget write to backend
  if (cacheBackend) {
    const ttl = ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
    cacheBackend.set(`transform:${key}`, JSON.stringify(entry), ttl).catch((error) => {
      logger.debug("[TransformCache] Backend set failed", { key, error });
    });

    // Also store locally for sync access
    if (cacheBackend.type === "memory") {
      setLocalFallback(key, entry);
    }
    return;
  }

  // Fallback to local memory
  setLocalFallback(key, entry);
}

function setLocalFallback(key: string, entry: TransformCacheEntry): void {
  localFallback.set(key, entry);
  if (localFallback.size > FALLBACK_MAX_ENTRIES) {
    pruneLocalFallback();
  }
}

function pruneLocalFallback(): void {
  const entries = Array.from(localFallback.entries()).sort(
    ([, a], [, b]) => a.timestamp - b.timestamp,
  );

  const excess = localFallback.size - FALLBACK_MAX_ENTRIES;
  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    localFallback.delete(key);
  }
}

export function destroyTransformCache(): void {
  localFallback.clear();
}

/**
 * Get cache statistics.
 */
export function getTransformCacheStats(): {
  fallbackEntries: number;
  maxFallbackEntries: number;
  backend: string;
} {
  return {
    fallbackEntries: localFallback.size,
    maxFallbackEntries: FALLBACK_MAX_ENTRIES,
    backend: cacheBackend?.type ?? "uninitialized",
  };
}
