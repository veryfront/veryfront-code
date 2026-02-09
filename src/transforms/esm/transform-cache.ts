import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { buildTransformCacheKey } from "#veryfront/cache/keys.ts";
import {
  type CacheBackend,
  CacheBackends,
  MemoryCacheBackend,
  type TokenizingCacheGateway,
} from "#veryfront/cache/backend.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache/paths.ts";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const FALLBACK_MAX_ENTRIES = 500;

/**
 * Pattern to match unresolved /_vf_modules/_veryfront/ imports.
 * These should have been resolved to file:// paths by ssrVfModulesPlugin.
 * Matches:
 * - from "/_vf_modules/_veryfront/..."
 * - from "file:///_vf_modules/_veryfront/..." (Deno adds file:// prefix to raw paths)
 */
const UNRESOLVED_VF_MODULES_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/_veryfront\/[^"']+)["']/;

export interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
  /** ID of the bundle manifest tracking HTTP bundles for this transform */
  bundleManifestId?: string;
}

let cacheGateway: TokenizingCacheGateway | null = null;
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
let injectedCacheGateway: TokenizingCacheGateway | CacheBackend | null | undefined = undefined;

function getLocalFallback(): LocalFallbackLike<string, TransformCacheEntry> {
  return injectedLocalFallback ?? defaultLocalFallback;
}

function getEffectiveCacheGateway(): TokenizingCacheGateway | CacheBackend | null {
  return injectedCacheGateway !== undefined ? injectedCacheGateway : cacheGateway;
}

// Backward compatibility: provide CacheBackend interface
function _getEffectiveCacheBackend(): CacheBackend | null {
  const gateway = getEffectiveCacheGateway();
  return gateway as CacheBackend | null;
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
    injectedCacheGateway = undefined;
    return;
  }

  if (caches.localFallback !== undefined) injectedLocalFallback = caches.localFallback;
  if (caches.cacheBackend !== undefined) injectedCacheGateway = caches.cacheBackend;
}

/**
 * Reset initialization state for testing.
 * This allows tests to simulate fresh initialization.
 */
export function __resetInitStateForTests(): void {
  cacheInitialized = false;
  cacheInitPromise = null;
  cacheGateway = null;
}

registerCache("transform-cache", () => ({
  name: "transform-cache",
  entries: getLocalFallback().size,
  maxEntries: FALLBACK_MAX_ENTRIES,
  backend: getEffectiveCacheGateway()?.type ?? "uninitialized",
}));

export async function initializeTransformCache(): Promise<boolean> {
  if (cacheInitialized) return cacheGateway?.type !== "memory";

  cacheInitPromise ??= (async () => {
    try {
      // Use TokenizingCacheGateway for consistent interface and isDistributed() checks
      cacheGateway = await CacheBackends.codeStore("TRANSFORM-CACHE", { keyPrefix: "transform" });
      logger.info("[TransformCache] Initialized with gateway", { backend: cacheGateway.type });
    } catch (error) {
      logger.warn("[TransformCache] Backend init failed, using memory", { error });
      // Fallback to memory backend wrapped in gateway for consistent interface
      const memBackend = new MemoryCacheBackend(FALLBACK_MAX_ENTRIES);
      const { createTokenizingGateway } = await import("../../cache/tokenizing-gateway.ts");
      cacheGateway = createTokenizingGateway(memBackend, "TRANSFORM-CACHE");
    } finally {
      cacheInitialized = true;
    }
  })();

  await cacheInitPromise;
  cacheInitPromise = null;

  return cacheGateway?.type !== "memory";
}

export function isDistributedCacheEnabled(): boolean {
  const gateway = getEffectiveCacheGateway();
  if (!gateway) return false;
  // Use gateway's isDistributed() if available, otherwise check type
  if ("isDistributed" in gateway && typeof gateway.isDistributed === "function") {
    return (gateway as TokenizingCacheGateway).isDistributed();
  }
  return gateway.type !== "memory";
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
  const gateway = getEffectiveCacheGateway();

  if (gateway) {
    try {
      // Use raw get() since we store JSON and handle tokenization at the entry level
      const raw = await gateway.get(key);
      if (raw) {
        const entry = JSON.parse(raw) as TransformCacheEntry;
        if (!entry.code) {
          logger.warn("[TransformCache] Cache entry has empty code, discarding", { key });
          return undefined;
        }
        // Detokenize code from distributed cache
        // The gateway's isDistributed() tells us if we need to detokenize
        const isDistributed = "isDistributed" in gateway
          ? (gateway as TokenizingCacheGateway).isDistributed()
          : gateway.type !== "memory";
        if (isDistributed) {
          entry.code = detokenizeAllCachePaths(entry.code);
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
  const gateway = getEffectiveCacheGateway();
  if (gateway && gateway.type !== "memory") return undefined;
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
  const gateway = getEffectiveCacheGateway();

  if (gateway) {
    try {
      // Tokenize code before storing in distributed cache
      // This replaces absolute file:// paths with __VF_CACHE_DIR__ tokens for cross-pod portability
      const isDistributed = "isDistributed" in gateway
        ? (gateway as TokenizingCacheGateway).isDistributed()
        : gateway.type !== "memory";
      const entryToStore = isDistributed
        ? { ...entry, code: tokenizeAllVeryFrontPaths(code) }
        : entry;
      await gateway.set(key, JSON.stringify(entryToStore), normalizeTtl(ttlSeconds));
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
  const gateway = getEffectiveCacheGateway();

  if (!gateway) {
    setLocalFallback(key, entry);
    return;
  }

  // Tokenize code before storing in distributed cache
  // This replaces absolute file:// paths with __VF_CACHE_DIR__ tokens for cross-pod portability
  const isDistributed = "isDistributed" in gateway
    ? (gateway as TokenizingCacheGateway).isDistributed()
    : gateway.type !== "memory";
  const entryToStore = isDistributed ? { ...entry, code: tokenizeAllVeryFrontPaths(code) } : entry;
  gateway.set(key, JSON.stringify(entryToStore), normalizeTtl(ttlSeconds)).catch((error) => {
    logger.debug("[TransformCache] Backend set failed", { key, error });
  });

  if (gateway.type === "memory") setLocalFallback(key, entry);
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
  const gateway = getEffectiveCacheGateway();
  if (!gateway || gateway.type === "memory") return null;
  return gateway as CacheBackend;
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
    // Validate cached code doesn't have unresolved _vf_modules imports.
    // These imports should have been resolved to file:// paths by ssrVfModulesPlugin.
    // If they're still present, the cache is stale and we need to recompute.
    if (UNRESOLVED_VF_MODULES_PATTERN.test(cached.code)) {
      const match = cached.code.match(UNRESOLVED_VF_MODULES_PATTERN);
      logger.warn("[TransformCache] Cache contains unresolved _vf_modules import, invalidating", {
        key: key.slice(-60),
        unresolvedImport: match?.[1]?.slice(0, 60),
      });
      // Fall through to recompute
    } else {
      logger.debug("[TransformCache] Cache hit", { key });
      return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
    }
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
    backend: getEffectiveCacheGateway()?.type ?? "uninitialized",
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
    backend: getEffectiveCacheGateway()?.type,
  });

  return { success, failed, skipped, durationMs };
}

export async function prewarmProjectTransforms(
  projectId: string,
  filePaths: string[],
): Promise<number> {
  await initializeTransformCache();
  const gateway = getEffectiveCacheGateway();

  if (!gateway || gateway.type === "memory") {
    logger.debug("[TransformCache] Prewarm skipped - no distributed cache");
    return 0;
  }

  let prewarmed = 0;
  for (const filePath of filePaths) {
    try {
      const pattern = `v*:${projectId}:${filePath}:*:ssr`;
      const scan = (gateway as any).scan;
      if (typeof scan !== "function") continue;

      const keys = await scan.call(gateway, pattern, 10);
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
