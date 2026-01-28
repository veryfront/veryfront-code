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
  /** ID of the bundle manifest tracking HTTP bundles for this transform */
  bundleManifestId?: string;
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

export interface CacheKeyOptions {
  depsHash?: string;
  configHash?: string;
  projectId?: string;
}

export function generateCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
  options?: CacheKeyOptions,
): string {
  return buildTransformCacheKey(filePath, contentHash, ssr, studioEmbed, options);
}

export async function getCachedTransformAsync(
  key: string,
): Promise<TransformCacheEntry | undefined> {
  if (cacheBackend) {
    try {
      const raw = await cacheBackend.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as TransformCacheEntry;
        if (!entry.code) {
          logger.warn("[TransformCache] Cache entry has empty code, discarding", { key });
          return undefined;
        }
        return entry;
      }
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
  bundleManifestId?: string,
): Promise<void> {
  const entry: TransformCacheEntry = { code, hash, timestamp: Date.now(), bundleManifestId };

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

/**
 * Get the underlying distributed cache backend.
 *
 * This is exposed for callers that need direct access to the distributed
 * cache (e.g., MDX module-fetcher that stores raw code strings instead of
 * TransformCacheEntry JSON). Ensures initialization happens only once.
 *
 * Returns null if distributed cache is not available (memory-only mode).
 */
export async function getDistributedTransformBackend(): Promise<CacheBackend | null> {
  await initializeTransformCache();
  if (!cacheBackend || cacheBackend.type === "memory") return null;
  return cacheBackend;
}

/** Result from getOrComputeTransform including metadata */
export interface TransformCacheResult {
  code: string;
  /** Bundle manifest ID if the cached entry has one (for manifest-based validation) */
  bundleManifestId?: string;
  /** Whether this was a cache hit */
  cacheHit: boolean;
}

/**
 * Get a cached transform or compute it if not found.
 *
 * This is the preferred way to use the transform cache - it handles:
 * - Cache lookup (distributed first, then local fallback)
 * - Compute on miss
 * - Cache storage on compute
 *
 * @param key - Cache key (use generateCacheKey to build it)
 * @param computeFn - Function to compute the transform if not cached
 * @param ttlSeconds - TTL for the cached entry
 * @returns The cached or computed code
 */
export async function getOrComputeTransform(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<TransformCacheResult> {
  // Try to get from cache first
  const cached = await getCachedTransformAsync(key);
  if (cached) {
    logger.debug("[TransformCache] Cache hit", { key });
    return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
  }

  // Compute on miss
  logger.debug("[TransformCache] Cache miss, computing", { key });
  const code = await computeFn();

  // Store in cache (fire-and-forget for performance)
  // Use content length + timestamp as hash for integrity tracking
  const hash = `${code.length}:${Date.now()}`;
  setCachedTransformAsync(key, code, hash, ttlSeconds).catch((error) => {
    logger.debug("[TransformCache] Failed to cache computed transform", { key, error });
  });

  return { code, cacheHit: false };
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
