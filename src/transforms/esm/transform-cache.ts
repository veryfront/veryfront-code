import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { buildTransformCacheKey } from "../../cache/keys.ts";
import { type CacheBackend, CacheBackends, MemoryCacheBackend } from "../../cache/backend.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";

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

const defaultLocalFallback = new Map<string, TransformCacheEntry>();

/**
 * Cache interface for local fallback dependency injection.
 */
export interface LocalFallbackLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
  readonly size: number;
  entries(): IterableIterator<[K, V]>;
}

/** Injected caches for testing */
let injectedLocalFallback: LocalFallbackLike<string, TransformCacheEntry> | null = null;
let injectedCacheBackend: CacheBackend | null | undefined = undefined; // undefined = not injected

function getLocalFallback(): LocalFallbackLike<string, TransformCacheEntry> {
  return injectedLocalFallback ?? defaultLocalFallback;
}

function getEffectiveCacheBackend(): CacheBackend | null {
  return injectedCacheBackend !== undefined ? injectedCacheBackend : cacheBackend;
}

/**
 * Inject custom caches for testing.
 * Call with null to restore default behavior.
 */
export function __injectCachesForTests(
  caches: {
    localFallback?: LocalFallbackLike<string, TransformCacheEntry> | null;
    cacheBackend?: CacheBackend | null;
  } | null,
): void {
  if (caches === null) {
    injectedLocalFallback = null;
    injectedCacheBackend = undefined;
    return;
  }
  if (caches.localFallback !== undefined) injectedLocalFallback = caches.localFallback;
  if (caches.cacheBackend !== undefined) injectedCacheBackend = caches.cacheBackend;
}

/**
 * Reset initialization state for testing.
 * This allows tests to simulate fresh initialization.
 */
export function __resetInitStateForTests(): void {
  cacheInitialized = false;
  cacheInitPromise = null;
  cacheBackend = null;
}

registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: getLocalFallback().size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: getEffectiveCacheBackend()?.type ?? "uninitialized",
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
  const backend = getEffectiveCacheBackend();
  return backend?.type !== "memory" && backend !== null;
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
  const backend = getEffectiveCacheBackend();
  if (backend) {
    try {
      const raw = await backend.get(key);
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

  return getLocalFallback().get(key);
}

export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  const backend = getEffectiveCacheBackend();
  if (backend?.type !== "memory" && backend !== null) return undefined;
  return getLocalFallback().get(key);
}

export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  bundleManifestId?: string,
): Promise<void> {
  const entry: TransformCacheEntry = { code, hash, timestamp: Date.now(), bundleManifestId };
  const backend = getEffectiveCacheBackend();

  if (backend) {
    try {
      await backend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds));
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
  const backend = getEffectiveCacheBackend();

  if (!backend) {
    setLocalFallback(key, entry);
    return;
  }

  backend.set(key, JSON.stringify(entry), normalizeTtl(ttlSeconds)).catch((error) => {
    logger.debug("[TransformCache] Backend set failed", { key, error });
  });

  if (backend.type === "memory") {
    setLocalFallback(key, entry);
  }
}

function normalizeTtl(ttlSeconds: number): number {
  return ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
}

function setLocalFallback(key: string, entry: TransformCacheEntry): void {
  const fallback = getLocalFallback();
  fallback.set(key, entry);
  if (fallback.size > FALLBACK_MAX_ENTRIES) pruneLocalFallback();
}

function pruneLocalFallback(): void {
  const fallback = getLocalFallback();
  const entries = Array.from(fallback.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp);
  const excess = fallback.size - FALLBACK_MAX_ENTRIES;

  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    fallback.delete(key);
  }
}

export function destroyTransformCache(): void {
  getLocalFallback().clear();
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
  const backend = getEffectiveCacheBackend();
  if (!backend || backend.type === "memory") return null;
  return backend;
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
  // Use proper content hash for integrity verification
  const hash = hashCodeHex(code).slice(0, 16);
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
    fallbackEntries: getLocalFallback().size,
    maxFallbackEntries: FALLBACK_MAX_ENTRIES,
    backend: getEffectiveCacheBackend()?.type ?? "uninitialized",
  };
}

export interface WarmupEntry {
  key: string;
  code: string;
  hash: string;
  bundleManifestId?: string;
}

export interface WarmupResult {
  success: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

/**
 * Warm up the transform cache with pre-computed entries.
 *
 * This function is designed to be called during deployment to pre-populate
 * the distributed cache, reducing P99 latency for cold starts. Each pod that
 * starts will have immediate access to cached transforms.
 *
 * @param entries - Array of transform entries to warm up
 * @param ttlSeconds - TTL for the cached entries (default: 1 hour for warmup)
 * @returns Summary of warmup results
 */
export async function warmupTransformCache(
  entries: WarmupEntry[],
  ttlSeconds: number = 3600,
): Promise<WarmupResult> {
  const start = performance.now();
  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Ensure cache is initialized
  await initializeTransformCache();

  // Check if distributed cache is available
  const isDistributed = isDistributedCacheEnabled();
  if (!isDistributed) {
    logger.warn("[TransformCache] Warmup skipped - no distributed cache available");
    return {
      success: 0,
      failed: 0,
      skipped: entries.length,
      durationMs: Math.round(performance.now() - start),
    };
  }

  // Process entries in batches to avoid overwhelming the cache backend
  const BATCH_SIZE = 50;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        // Check if already cached
        const existing = await getCachedTransformAsync(entry.key);
        if (existing && existing.hash === entry.hash) {
          skipped++;
          return;
        }

        await setCachedTransformAsync(
          entry.key,
          entry.code,
          entry.hash,
          ttlSeconds,
          entry.bundleManifestId,
        );
        success++;
      }),
    );

    // Count failures
    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        logger.debug("[TransformCache] Warmup entry failed", {
          error: result.reason,
        });
      }
    }
  }

  const durationMs = Math.round(performance.now() - start);
  logger.info("[TransformCache] Warmup complete", {
    success,
    failed,
    skipped,
    total: entries.length,
    durationMs,
    backend: getEffectiveCacheBackend()?.type,
  });

  return { success, failed, skipped, durationMs };
}

/**
 * Pre-warm the cache for a specific project by fetching known hot paths.
 *
 * This is a convenience function that can be called during pod startup
 * to ensure commonly-accessed transforms are cached locally.
 *
 * @param projectId - The project ID to warm up
 * @param filePaths - Array of file paths to warm up
 * @returns Number of entries pre-warmed
 */
export async function prewarmProjectTransforms(
  projectId: string,
  filePaths: string[],
): Promise<number> {
  await initializeTransformCache();
  const backend = getEffectiveCacheBackend();

  if (!backend || backend.type === "memory") {
    logger.debug("[TransformCache] Prewarm skipped - no distributed cache");
    return 0;
  }

  let prewarmed = 0;
  for (const filePath of filePaths) {
    // Check distributed cache and copy to local if found
    // This brings entries into local memory for faster access
    try {
      // We don't know the exact cache key without content hash, but we can
      // use pattern matching if the backend supports it
      const pattern = `v*:${projectId}:${filePath}:*:ssr`;
      if (typeof (backend as any).scan === "function") {
        const keys = await (backend as any).scan(pattern, 10);
        for (const key of keys) {
          const cached = await getCachedTransformAsync(key);
          if (cached) {
            // Use setLocalFallback to respect size limits and prevent memory leaks
            setLocalFallback(key, cached);
            prewarmed++;
          }
        }
      }
    } catch (error) {
      logger.debug("[TransformCache] Prewarm failed for path", { projectId, filePath, error });
    }
  }

  logger.debug("[TransformCache] Prewarm complete", {
    projectId,
    prewarmed,
    total: filePaths.length,
  });
  return prewarmed;
}
