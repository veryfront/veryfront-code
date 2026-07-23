import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { buildTransformCacheKey } from "#veryfront/cache/keys.ts";
import {
  type CacheBackend,
  CacheBackends,
  MemoryCacheBackend,
  type TokenizingCacheGateway,
} from "#veryfront/cache/backend.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache/paths.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { errorLogName } from "../shared/log-context.ts";

const logger = baseLogger.component("transform-cache");

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const FALLBACK_MAX_ENTRIES = 500;

function cacheKeyLogId(key: string): string {
  return hashCodeHex(key).slice(0, 16);
}

/**
 * Pattern to match unresolved /_vf_modules/_veryfront/ imports.
 * These should have been resolved to file:// paths by ssrVfModulesPlugin.
 * Matches:
 * - from "/_vf_modules/_veryfront/..."
 * - from "file:///_vf_modules/_veryfront/..." (Deno adds file:// prefix to raw paths)
 */
const UNRESOLVED_VF_MODULES_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/_veryfront\/[^"']+)["']/;

interface TransformCacheEntry {
  code: string;
  hash: string;
  timestamp: number;
  /** Absolute expiration time for the local fallback. Legacy distributed entries may omit it. */
  expiresAt?: number;
  /** ID of the bundle manifest tracking HTTP bundles for this transform */
  bundleManifestId?: string;
}

let cacheGateway: TokenizingCacheGateway | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;

interface LocalFallbackLike<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
  delete(key: K): boolean;
  has(key: K): boolean;
  clear(): void;
  readonly size: number;
  entries(): IterableIterator<[K, V]>;
}

class EntryBoundedFallback<K, V> implements LocalFallbackLike<K, V> {
  private readonly store = new Map<K, V>();

  constructor(private readonly maxEntries: number) {}

  get(key: K): V | undefined {
    const value = this.store.get(key);
    if (value === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.store.delete(key);
    this.store.set(key, value);

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next();
      if (oldestKey.done) break;
      this.store.delete(oldestKey.value);
    }
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  has(key: K): boolean {
    return this.store.has(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  entries(): IterableIterator<[K, V]> {
    return this.store.entries();
  }
}

const defaultLocalFallback = new EntryBoundedFallback<string, TransformCacheEntry>(
  FALLBACK_MAX_ENTRIES,
);

/** Injected caches for testing */
let injectedLocalFallback: LocalFallbackLike<string, TransformCacheEntry> | null = null;
let injectedCacheGateway: TokenizingCacheGateway | CacheBackend | null | undefined = undefined;

function getLocalFallback(): LocalFallbackLike<string, TransformCacheEntry> {
  return injectedLocalFallback ?? defaultLocalFallback;
}

function getEffectiveCacheGateway(): TokenizingCacheGateway | CacheBackend | null {
  return injectedCacheGateway !== undefined ? injectedCacheGateway : cacheGateway;
}

function getLocalFallbackEntry(key: string): TransformCacheEntry | undefined {
  const fallback = getLocalFallback();
  const entry = fallback.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
    fallback.delete(key);
    return undefined;
  }
  return entry;
}

function parseTransformCacheEntry(raw: string): TransformCacheEntry | undefined {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (
    typeof record.code !== "string" || record.code.length === 0 ||
    typeof record.hash !== "string" || record.hash.length === 0 || record.hash.length > 4_096 ||
    typeof record.timestamp !== "number" || !Number.isFinite(record.timestamp) ||
    record.timestamp < 0 ||
    (record.expiresAt !== undefined &&
      (typeof record.expiresAt !== "number" || !Number.isFinite(record.expiresAt) ||
        record.expiresAt < 0)) ||
    (record.bundleManifestId !== undefined &&
      (typeof record.bundleManifestId !== "string" || record.bundleManifestId.length === 0 ||
        record.bundleManifestId.length > 4_096))
  ) {
    return undefined;
  }

  return {
    code: record.code,
    hash: record.hash,
    timestamp: record.timestamp,
    expiresAt: record.expiresAt as number | undefined,
    bundleManifestId: record.bundleManifestId as string | undefined,
  };
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
function __resetInitStateForTests(): void {
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
      logger.info("Initialized with gateway", { backend: cacheGateway.type });
    } catch (error) {
      logger.warn("Backend init failed, using memory", { errorName: errorLogName(error) });
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

interface CacheKeyOptions {
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
        const entry = parseTransformCacheEntry(raw);
        if (!entry) {
          logger.warn("Cache entry is malformed, discarding", { keyId: cacheKeyLogId(key) });
          return undefined;
        }
        if (entry.expiresAt !== undefined && Date.now() >= entry.expiresAt) {
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
      logger.error("Transform cache backend get failed", {
        keyId: cacheKeyLogId(key),
        errorName: errorLogName(error),
      });
    }
  }

  return getLocalFallbackEntry(key);
}

export function getCachedTransform(key: string): TransformCacheEntry | undefined {
  const gateway = getEffectiveCacheGateway();
  if (gateway && gateway.type !== "memory") return undefined;
  return getLocalFallbackEntry(key);
}

export async function setCachedTransformAsync(
  key: string,
  code: string,
  hash: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  bundleManifestId?: string,
): Promise<void> {
  const normalizedTtl = normalizeTtl(ttlSeconds);
  const entry = createTransformCacheEntry(code, hash, normalizedTtl, bundleManifestId);
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
      await gateway.set(key, JSON.stringify(entryToStore), normalizedTtl);
      return;
    } catch (error) {
      logger.error("Transform cache backend set failed", {
        keyId: cacheKeyLogId(key),
        errorName: errorLogName(error),
      });
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
  const normalizedTtl = normalizeTtl(ttlSeconds);
  const entry = createTransformCacheEntry(code, hash, normalizedTtl);
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
  gateway.set(key, JSON.stringify(entryToStore), normalizedTtl).catch((error) => {
    logger.debug("Backend set failed", {
      keyId: cacheKeyLogId(key),
      errorName: errorLogName(error),
    });
  });

  if (gateway.type === "memory") setLocalFallback(key, entry);
}

function normalizeTtl(ttlSeconds: number): number {
  return Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
}

function createTransformCacheEntry(
  code: string,
  hash: string,
  ttlSeconds: number,
  bundleManifestId?: string,
): TransformCacheEntry {
  const timestamp = Date.now();
  const requestedExpiry = timestamp + ttlSeconds * 1_000;
  const expiresAt = Math.min(
    Number.MAX_SAFE_INTEGER,
    Number.isFinite(requestedExpiry) ? requestedExpiry : Number.MAX_SAFE_INTEGER,
  );
  return { code, hash, timestamp, expiresAt, bundleManifestId };
}

function setLocalFallback(key: string, entry: TransformCacheEntry): void {
  const fallback = getLocalFallback();
  fallback.set(key, entry);
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

interface TransformCacheResult {
  code: string;
  /** Bundle manifest ID if the cached entry has one (for manifest-based validation) */
  bundleManifestId?: string;
  /** Whether this was a cache hit */
  cacheHit: boolean;
}

const transformComputeFlight = new Singleflight<TransformCacheResult>();

export async function getOrComputeTransform(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<TransformCacheResult> {
  return await transformComputeFlight.do(
    key,
    () => getOrComputeTransformOnce(key, computeFn, ttlSeconds),
  );
}

async function getOrComputeTransformOnce(
  key: string,
  computeFn: () => Promise<string>,
  ttlSeconds: number,
): Promise<TransformCacheResult> {
  const cached = await getCachedTransformAsync(key);
  if (cached) {
    // Validate cached code doesn't have unresolved _vf_modules imports.
    // These imports should have been resolved to file:// paths by ssrVfModulesPlugin.
    // If they're still present, the cache is stale and we need to recompute.
    if (UNRESOLVED_VF_MODULES_PATTERN.test(cached.code)) {
      logger.warn("Cache contains unresolved _vf_modules import, invalidating", {
        keyId: cacheKeyLogId(key),
      });
      // Fall through to recompute
    } else {
      logger.debug("Cache hit", { keyId: cacheKeyLogId(key) });
      return { code: cached.code, bundleManifestId: cached.bundleManifestId, cacheHit: true };
    }
  }

  logger.debug("Cache miss, computing", { keyId: cacheKeyLogId(key) });
  const code = await computeFn();

  const hash = hashCodeHex(code).slice(0, 16);
  await setCachedTransformAsync(key, code, hash, ttlSeconds).catch((error) => {
    logger.debug("Failed to cache computed transform", {
      keyId: cacheKeyLogId(key),
      errorName: errorLogName(error),
    });
  });

  return { code, cacheHit: false };
}
