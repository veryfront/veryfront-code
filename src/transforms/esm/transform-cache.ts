import { registerCache } from "#veryfront/utils/memory/index.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { buildTransformCacheKey } from "#veryfront/cache/keys.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import {
  type CacheBackend,
  CacheBackends,
  MemoryCacheBackend,
  type TokenizingCacheGateway,
} from "#veryfront/cache/backend.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { detokenizeAllCachePaths, tokenizeAllVeryFrontPaths } from "#veryfront/cache/paths.ts";
import type {
  TransformProgressEvent,
  TransformProgressListener,
} from "#veryfront/transforms/progress.ts";

const logger = baseLogger.component("transform-cache");

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const FALLBACK_MAX_ENTRIES = 500;
export const TRANSFORM_FLIGHT_STALE_EVICTION_MS = 5 * 60_000;

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
  /** ID of the bundle manifest tracking HTTP bundles for this transform */
  bundleManifestId?: string;
}

let cacheGateway: TokenizingCacheGateway | null = null;
let cacheInitialized = false;
let cacheInitPromise: Promise<void> | null = null;
let transformFlight = new Singleflight<TransformCacheResult>();
const transformCachePublications = new Map<string, Promise<void>>();

interface TransformProgressState {
  listeners: Set<TransformProgressListener>;
  flights: number;
  lastEvent?: TransformProgressEvent;
}

const transformProgress = new Map<string, TransformProgressState>();

function ensureTransformProgressState(key: string): TransformProgressState {
  let state = transformProgress.get(key);
  if (!state) {
    state = { listeners: new Set(), flights: 0 };
    transformProgress.set(key, state);
  }
  return state;
}

function deleteTransformProgressStateIfIdle(key: string, state: TransformProgressState): void {
  if (state.flights === 0 && state.listeners.size === 0) {
    transformProgress.delete(key);
  }
}

function beginTransformProgressFlight(key: string): {
  state: TransformProgressState;
  end: () => void;
} {
  const state = ensureTransformProgressState(key);
  state.flights++;

  return {
    state,
    end: () => {
      state.flights = Math.max(0, state.flights - 1);
      if (transformProgress.get(key) === state) {
        deleteTransformProgressStateIfIdle(key, state);
      }
    },
  };
}

function notifyTransformProgressListener(
  key: string,
  listener: TransformProgressListener,
  event: TransformProgressEvent,
): void {
  try {
    listener(event);
  } catch (error) {
    logger.debug("Transform progress listener failed", { key, error });
  }
}

function subscribeToTransformProgress(
  key: string,
  listener?: TransformProgressListener,
): () => void {
  if (!listener) return () => {};

  const state = ensureTransformProgressState(key);
  state.listeners.add(listener);
  if (state.lastEvent) notifyTransformProgressListener(key, listener, state.lastEvent);

  return () => {
    state.listeners.delete(listener);
    if (transformProgress.get(key) === state) {
      deleteTransformProgressStateIfIdle(key, state);
    }
  };
}

function publishTransformProgress(
  key: string,
  state: TransformProgressState,
  event: TransformProgressEvent,
): void {
  if (transformProgress.get(key) !== state) return;
  state.lastEvent = event;
  for (const listener of state.listeners) {
    notifyTransformProgressListener(key, listener, event);
  }
}

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
      logger.warn("Backend init failed, using memory", { error });
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
        const entry = JSON.parse(raw) as TransformCacheEntry;
        if (!entry.code) {
          logger.warn("Cache entry has empty code, discarding", { key });
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
        key: key.slice(-60),
        error: error instanceof Error ? error.message : String(error),
      });
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
      logger.error("Transform cache backend set failed", {
        key: key.slice(-60),
        error: error instanceof Error ? error.message : String(error),
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
    logger.debug("Backend set failed", { key, error });
  });

  if (gateway.type === "memory") setLocalFallback(key, entry);
}

function normalizeTtl(ttlSeconds: number): number {
  return ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
}

function setLocalFallback(key: string, entry: TransformCacheEntry): void {
  const fallback = getLocalFallback();
  fallback.set(key, entry);
}

export function destroyTransformCache(): void {
  getLocalFallback().clear();
  transformFlight = new Singleflight<TransformCacheResult>();
  transformProgress.clear();
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

function publishComputedTransform(
  key: string,
  code: string,
  ttlSeconds: number,
): void {
  const previousPublication = transformCachePublications.get(key) ?? Promise.resolve();
  const publication = previousPublication
    .catch(() => {})
    .then(async () => {
      const hash = hashCodeHex(code).slice(0, 16);
      await setCachedTransformAsync(key, code, hash, ttlSeconds);
    })
    .finally(() => {
      if (transformCachePublications.get(key) === publication) {
        transformCachePublications.delete(key);
      }
    });

  transformCachePublications.set(key, publication);
  void publication.catch((error) => {
    logger.debug("Failed to cache computed transform", { key, error });
  });
}

export async function getOrComputeTransform(
  key: string,
  computeFn: (reportProgress?: TransformProgressListener) => Promise<string>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  onProgress?: TransformProgressListener,
  signal?: AbortSignal,
): Promise<TransformCacheResult> {
  signal?.throwIfAborted();
  const flightRegistry = transformFlight;
  if (!flightRegistry.has(key)) {
    transformProgress.set(key, { listeners: new Set(), flights: 0 });
  }
  const unsubscribe = subscribeToTransformProgress(key, onProgress);

  try {
    const flight = flightRegistry.do(
      key,
      async (control) => {
        const progressFlight = beginTransformProgressFlight(key);
        const reportProgress: TransformProgressListener = (event) =>
          publishTransformProgress(key, progressFlight.state, event);
        try {
          const cached = await getCachedTransformAsync(key);
          if (cached) {
            // Validate cached code doesn't have unresolved _vf_modules imports.
            // These imports should have been resolved to file:// paths by ssrVfModulesPlugin.
            // If they're still present, the cache is stale and we need to recompute.
            if (UNRESOLVED_VF_MODULES_PATTERN.test(cached.code)) {
              const match = cached.code.match(UNRESOLVED_VF_MODULES_PATTERN);
              logger.warn("Cache contains unresolved _vf_modules import, invalidating", {
                key: key.slice(-60),
                unresolvedImport: match?.[1]?.slice(0, 60),
              });
              // Fall through to recompute
            } else {
              logger.debug("Cache hit", { key });
              reportProgress({ phase: "transform-cache:hit" });
              return {
                code: cached.code,
                bundleManifestId: cached.bundleManifestId,
                cacheHit: true,
              };
            }
          }

          logger.debug("Cache miss, computing", { key });
          reportProgress({ phase: "transform-cache:miss" });
          const code = await computeFn(reportProgress);
          reportProgress({ phase: "transform-cache:computed" });

          if (transformFlight === flightRegistry && control.isCurrent()) {
            // Serialize publications for one key. If this generation is reset
            // after this synchronous identity check, a replacement publication
            // queues behind it and therefore commits last.
            publishComputedTransform(key, code, ttlSeconds);
          } else {
            logger.debug("Skipped cache write from stale transform flight", {
              key: key.slice(-60),
            });
          }

          return { code, cacheHit: false };
        } finally {
          progressFlight.end();
        }
      },
      {
        staleAfterMs: TRANSFORM_FLIGHT_STALE_EVICTION_MS,
        onStaleEvicted: () => {
          logger.warn("Evicted stalled transform-cache flight", {
            key: key.slice(-60),
            timeoutMs: TRANSFORM_FLIGHT_STALE_EVICTION_MS,
          });
        },
      },
    );

    if (!signal) return await flight;

    // A caller timeout must detach that request without cancelling the shared
    // singleflight leader: another concurrent render may still depend on the
    // same cold transform, and completing it warms the cache for later work.
    return await new Promise<TransformCacheResult>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason);
      if (signal.aborted) {
        // The shared flight can still fail after this caller detaches. Attach a
        // rejection observer so an already-aborted sole caller does not leave
        // the coordinating promise unhandled.
        void flight.catch(() => {});
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      flight.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  } finally {
    unsubscribe();
  }
}
