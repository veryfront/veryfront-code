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
  if (cacheInitialized) return cacheBackend?.type !== "memory";

  cacheInitPromise ??= (async () => {
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

  await cacheInitPromise;
  cacheInitPromise = null;

  return cacheBackend?.type !== "memory";
}

export function isDistributedCacheEnabled(): boolean {
  const backend = getEffectiveCacheBackend();
  return backend !== null && backend.type !== "memory";
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
  if (backend && backend.type !== "memory") return undefined;
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

  if (backend.type === "memory") setLocalFallback(key, entry);
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
  const excess = fallback.size - FALLBACK_MAX_ENTRIES;
  if (excess <= 0) return;

  const entries = Array.from(fallback.entries()).sort(([, a], [, b]) => a.timestamp - b.timestamp);
  for (let i = 0; i < excess; i++) {
    const [key] = entries[i]!;
    fallback.delete(key);
  }
}

export function destroyTransformCache(): void {
  getLocalFallback().clear();
}

export async function getDistributedTransformBackend(): Promise<CacheBackend | null> {
  await initializeTransformCache();
  const backend = getEffectiveCacheBackend();
  if (!backend || backend.type === "memory") return null;
  return backend;
}

export interface TransformCacheResult {
  code: string;
  /** Bundle manifest ID if the cached entry has one (for manifest-based validation) */
  bundleManifestId?: string;
  /** Whether this was a cache hit */
  cacheHit: boolean;
}

export async function getOrComputeTransform(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<TransformCacheResult> {
  const cached = await getCachedTransformAsync(key);
  if (cached) {
    logger.debug("[TransformCache] Cache hit", { key });
    return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
  }

  logger.debug("[TransformCache] Cache miss, computing", { key });
  const code = await computeFn();

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

export async function warmupTransformCache(
  entries: WarmupEntry[],
  ttlSeconds: number = 3600,
): Promise<WarmupResult> {
  const start = performance.now();
  let success = 0;
  let failed = 0;
  let skipped = 0;

  await initializeTransformCache();

  if (!isDistributedCacheEnabled()) {
    logger.warn("[TransformCache] Warmup skipped - no distributed cache available");
    return {
      success: 0,
      failed: 0,
      skipped: entries.length,
      durationMs: Math.round(performance.now() - start),
    };
  }

  const BATCH_SIZE = 50;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
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

    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        logger.debug("[TransformCache] Warmup entry failed", { error: result.reason });
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
    try {
      const pattern = `v*:${projectId}:${filePath}:*:ssr`;
      const scan = (backend as any).scan;
      if (typeof scan !== "function") continue;

      const keys = await scan.call(backend, pattern, 10);
      for (const key of keys) {
        const cached = await getCachedTransformAsync(key);
        if (!cached) continue;

        setLocalFallback(key, cached);
        prewarmed++;
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
