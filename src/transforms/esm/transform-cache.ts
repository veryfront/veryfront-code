import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { buildTransformCacheKey } from "../../cache/keys.ts";
import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "../../cache/backend.ts";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const FALLBACK_MAX_ENTRIES = 500;

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
}

let cacheBackend: CacheBackend | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

const localFallback = new Map<string, TransformCacheEntry>();

registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: localFallback.size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: cacheBackend?.type ?? "uninitialized",
}));

export async function initializeTransformCache(): Promise<boolean> {
  if (cacheInitialized) {
    return cacheBackend?.type !== "memory";
  }

  if (!cacheInitPromise) {
    cacheInitPromise = (async () => {
      try {
        cacheBackend = await CacheBackends.transform();
        logger.info("[TransformCache] Initialized", { backend: cacheBackend.type });
      } catch (error) {
        logger.warn("[TransformCache] Backend init failed, using memory", { error });
        cacheBackend = new MemoryCacheBackend(FALLBACK_MAX_ENTRIES);
      } finally {
        cacheInitialized = true;
      }
    })();
  }

  await cacheInitPromise;
  cacheInitPromise = null;

  return cacheBackend?.type !== "memory";
}

export function isDistributedCacheEnabled(): boolean {
  return cacheBackend?.type !== "memory" && cacheBackend !== null;
}

/** @deprecated Use initializeTransformCache instead */
export const initializeRedisCache = initializeTransformCache;

/** @deprecated Use isDistributedCacheEnabled instead */
export const isRedisCacheEnabled = isDistributedCacheEnabled;

export function generateCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
): string {
  return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed);
}

export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  if (cacheBackend) {
    try {
      const raw = await cacheBackend.get(key);
      if (raw) return JSON.parse(raw) as TransformCacheEntry;
    } catch (error) {
      logger.debug("[TransformCache] Backend get failed", { key, error });
    }
  }

  return localFallback.get(key);
}

export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  if (cacheBackend?.type !== "memory" && cacheBackend !== null) return undefined;
  return localFallback.get(key);
}

export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  const entry: TransformCacheEntry = { code, hash, timestamp: Date.now() };

  if (cacheBackend) {
    try {
      await cacheBackend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds));
      return;
    } catch (error) {
      logger.debug("[TransformCache] Backend set failed", { key, error });
    }
  }

  setLocalFallback(key, entry);
}

export function setCachedTransform(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): void {
  const entry: TransformCacheEntry = { code, hash, timestamp: Date.now() };

  if (!cacheBackend) {
    setLocalFallback(key, entry);
    return;
  }

  cacheBackend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds)).catch((error) => {
    logger.debug("[TransformCache] Backend set failed", { key, error });
  });

  if (cacheBackend.type === "memory") {
    setLocalFallback(key, entry);
  }
}

function normalizeTtl(ttlSeconds: number): number {
  return ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
}

function setLocalFallback(key: string, entry: TransformCacheEntry): void {
  localFallback.set(key, entry);
  if (localFallback.size > FALLBACK_MAX_ENTRIES) pruneLocalFallback();
}

function pruneLocalFallback(): void {
  const entries = Array.from(localFallback.entries()).sort(([, a], [, b]) =>
    a.timestamp - b.timestamp
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
