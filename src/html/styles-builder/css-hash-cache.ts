/**
 * CSS hash-based distributed cache.
 *
 * Manages CSS caching by content hash, supporting both local in-memory
 * and distributed (API/Redis) backends. Provides unified cache entries
 * that store CSS alongside its generation inputs for JIT regeneration.
 *
 * @module html/styles-builder/css-hash-cache
 */

import {
  type CacheBackend,
  createCacheBackend,
  MemoryCacheBackend,
} from "#veryfront/cache/backend.ts";
import { serverLogger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { assertCSSContentIdentity, hashCSS, isCSSContentHash } from "./css-identity.ts";
import {
  buildCSSCacheEntry,
  parseCSSCacheEntry,
  resolveStylesheet,
} from "./tailwind-compiler-utils.ts";

const logger = serverLogger.component("tailwind");

// ============================================================================
// Types
// ============================================================================

/**
 * Unified CSS cache entry - stores CSS and inputs together.
 * This ensures CSS and its regeneration inputs always expire together,
 * enabling reliable JIT regeneration across pods.
 */
export interface CSSCacheEntry {
  css: string;
  candidates: string[];
  stylesheet: string;
}

/**
 * CSS inputs cache entry - stores the inputs needed to regenerate CSS.
 * Keyed by CSS hash, stores candidates and stylesheet for JIT regeneration.
 */
interface CSSInputsCacheEntry {
  candidates: string[];
  stylesheet: string;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_STYLESHEET = `@import "tailwindcss";
@plugin "@tailwindcss/typography";
@custom-variant dark (&:is(.dark, [data-theme="dark"]) *, &:is(.dark, [data-theme="dark"]));`;

// CSS cache TTL: 24 hours (API maximum) for content-addressed immutable resources.
const CSS_CACHE_TTL_SECONDS = 24 * 3600;

const LOCAL_CACHE_MAX_SIZE = 100;
const LOCAL_CSS_INPUTS_CACHE_MAX = 50;
const CSS_CACHE_SCHEMA = "v2";

// ============================================================================
// Distributed cache initialization infrastructure
// ============================================================================

interface DistributedCacheInitOptions {
  getCache: () => CacheBackend | null;
  getCacheInitPromise: () => Promise<CacheBackend> | null;
  setCache: (cache: CacheBackend) => void;
  setCacheInitPromise: (promise: Promise<CacheBackend>) => void;
  keyPrefix: string;
  localFallbackSize: number;
  initializedLog: string;
  initFailureLog: string;
}

async function getOrInitializeDistributedCache(
  options: DistributedCacheInitOptions,
): Promise<CacheBackend> {
  const existing = options.getCache();
  if (existing) return existing;

  const pending = options.getCacheInitPromise();
  if (pending) return pending;

  const initPromise = (async () => {
    try {
      const backend = await createCacheBackend({ keyPrefix: options.keyPrefix });
      options.setCache(backend);
      logger.debug(options.initializedLog, { type: backend.type });
      return backend;
    } catch (error) {
      logger.warn(options.initFailureLog, { error });
      const fallback = new MemoryCacheBackend(options.localFallbackSize);
      options.setCache(fallback);
      return fallback;
    }
  })();

  options.setCacheInitPromise(initPromise);
  return initPromise;
}

// ============================================================================
// Bounded local cache utility
// ============================================================================

function storeInBoundedLocalCache<T>(
  cache: Map<string, T>,
  maxSize: number,
  key: string,
  entry: T,
): void {
  if (cache.has(key)) return;

  if (cache.size >= maxSize) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey) cache.delete(firstKey);
  }

  cache.set(key, entry);
}

// ============================================================================
// CSS cache state
// ============================================================================

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;

const localCssCache = new Map<string, CSSCacheEntry>();

const cssCacheOptions: DistributedCacheInitOptions = {
  getCache: () => cssCache,
  getCacheInitPromise: () => cssCacheInitPromise,
  setCache: (cache) => {
    cssCache = cache;
  },
  setCacheInitPromise: (promise) => {
    cssCacheInitPromise = promise;
  },
  keyPrefix: "css",
  localFallbackSize: LOCAL_CACHE_MAX_SIZE,
  initializedLog: "[tailwind] CSS cache initialized",
  initFailureLog: "[tailwind] Failed to initialize distributed CSS cache, using memory",
};

function getCssCache(): Promise<CacheBackend> {
  return getOrInitializeDistributedCache(cssCacheOptions);
}

function storeInLocalCache(hash: string, entry: CSSCacheEntry): void {
  storeInBoundedLocalCache(localCssCache, LOCAL_CACHE_MAX_SIZE, hash, entry);
}

function touchLocalCache(hash: string, entry: CSSCacheEntry): void {
  localCssCache.delete(hash);
  localCssCache.set(hash, entry);
}

// ============================================================================
// CSS inputs cache state
// ============================================================================

let cssInputsCache: CacheBackend | null = null;
let cssInputsCacheInitPromise: Promise<CacheBackend> | null = null;
const localCssInputsCache = new Map<string, CSSInputsCacheEntry>();

const cssInputsCacheOptions: DistributedCacheInitOptions = {
  getCache: () => cssInputsCache,
  getCacheInitPromise: () => cssInputsCacheInitPromise,
  setCache: (cache) => {
    cssInputsCache = cache;
  },
  setCacheInitPromise: (promise) => {
    cssInputsCacheInitPromise = promise;
  },
  keyPrefix: "css-inputs",
  localFallbackSize: LOCAL_CSS_INPUTS_CACHE_MAX,
  initializedLog: "[tailwind] CSS inputs cache initialized",
  initFailureLog: "[tailwind] Failed to initialize CSS inputs cache, using memory",
};

function getCssInputsCache(): Promise<CacheBackend> {
  return getOrInitializeDistributedCache(cssInputsCacheOptions);
}

function storeInLocalCssInputsCache(hash: string, entry: CSSInputsCacheEntry): void {
  storeInBoundedLocalCache(localCssInputsCache, LOCAL_CSS_INPUTS_CACHE_MAX, hash, entry);
}

function getVersionedCacheKey(hash: string): string {
  return `${CSS_CACHE_SCHEMA}:${hash}`;
}

function isCSSCacheEntryForHash(entry: CSSCacheEntry, hash: string): boolean {
  return isCSSContentHash(hash) && hashCSS(entry.css) === hash;
}

function parseCSSInputsCacheEntry(raw: string): CSSInputsCacheEntry | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<CSSInputsCacheEntry>;
    if (
      !Array.isArray(parsed.candidates) ||
      !parsed.candidates.every((candidate) => typeof candidate === "string") ||
      typeof parsed.stylesheet !== "string"
    ) {
      return undefined;
    }
    return { candidates: [...parsed.candidates], stylesheet: parsed.stylesheet };
  } catch {
    return undefined;
  }
}

// ============================================================================
// Public API - CSS cache operations
// ============================================================================

/**
 * Cache CSS with its generation inputs for JIT regeneration.
 * Stores CSS and inputs together so they expire at the same time,
 * ensuring any pod can regenerate the CSS if needed.
 */
export async function cacheCSSAsync(
  css: string,
  hash?: string,
  inputs?: { candidates: string[] | Set<string>; stylesheet: string },
): Promise<string> {
  const resolvedHash = hashCSS(css);
  if (hash !== undefined) assertCSSContentIdentity(css, hash);
  const entry: CSSCacheEntry = buildCSSCacheEntry(css, inputs, DEFAULT_STYLESHEET);

  storeInLocalCache(resolvedHash, entry);

  try {
    const cache = await getCssCache();
    await cache.set(
      getVersionedCacheKey(resolvedHash),
      JSON.stringify(entry),
      CSS_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    logger.debug("Failed to store CSS in distributed cache", {
      hash: resolvedHash,
      error,
    });
  }

  return resolvedHash;
}

export function getCSSByHash(hash: string): string | undefined {
  if (!isCSSContentHash(hash)) return undefined;
  const entry = localCssCache.get(hash);
  if (entry) {
    if (!isCSSCacheEntryForHash(entry, hash)) {
      localCssCache.delete(hash);
      return undefined;
    }
    touchLocalCache(hash, entry);
    return entry.css;
  }
  return undefined;
}

export async function getCSSByHashAsync(hash: string): Promise<string | undefined> {
  if (!isCSSContentHash(hash)) return undefined;

  return await withSpan(
    SpanNames.HTML_GET_CSS_BY_HASH,
    async () => {
      const local = localCssCache.get(hash);
      if (local) {
        if (!isCSSCacheEntryForHash(local, hash)) {
          localCssCache.delete(hash);
          return undefined;
        }
        touchLocalCache(hash, local);
        return local.css;
      }

      try {
        const cache = await getCssCache();
        const raw = await cache.get(getVersionedCacheKey(hash));
        if (!raw) return undefined;

        const entry = parseCSSCacheEntry(raw, DEFAULT_STYLESHEET);
        if (!isCSSCacheEntryForHash(entry, hash)) {
          logger.warn("Rejected CSS cache entry with mismatched content identity", { hash });
          return undefined;
        }

        storeInLocalCache(hash, entry);
        logger.debug("CSS cache hit from distributed cache", { hash });
        return entry.css;
      } catch (error) {
        logger.debug("Failed to read from distributed CSS cache", { hash, error });
        return undefined;
      }
    },
    { "css.hash": hash },
  );
}

export function clearCSSCache(): void {
  localCssCache.clear();
  localCssInputsCache.clear();
}

/**
 * Cache legacy CSS regeneration inputs by hash.
 * Maintains backward compatibility with older cache layouts that stored inputs separately.
 */
export async function cacheCSSInputsAsync(
  hash: string,
  inputs: { candidates: string[] | Set<string>; stylesheet: string },
): Promise<void> {
  if (!isCSSContentHash(hash)) {
    throw new TypeError("CSS hash must be a full lowercase SHA-256 digest");
  }

  const entry: CSSInputsCacheEntry = {
    candidates: Array.isArray(inputs.candidates) ? inputs.candidates : [...inputs.candidates],
    stylesheet: resolveStylesheet(inputs.stylesheet, DEFAULT_STYLESHEET),
  };

  storeInLocalCssInputsCache(hash, entry);

  try {
    const cache = await getCssInputsCache();
    await cache.set(getVersionedCacheKey(hash), JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("Failed to store CSS inputs in distributed cache", {
      hash,
      error,
    });
  }
}

// ============================================================================
// JIT regeneration helpers
// ============================================================================

/**
 * Get CSS cache entry with inputs for JIT regeneration.
 * Returns the full entry (CSS + inputs) if available.
 */
async function getCSSCacheEntry(hash: string): Promise<CSSCacheEntry | undefined> {
  if (!isCSSContentHash(hash)) return undefined;

  const local = localCssCache.get(hash);
  if (local && local.candidates.length > 0) {
    if (!isCSSCacheEntryForHash(local, hash)) {
      localCssCache.delete(hash);
      return undefined;
    }
    touchLocalCache(hash, local);
    return local;
  }

  try {
    const cache = await getCssCache();
    const raw = await cache.get(getVersionedCacheKey(hash));
    if (!raw) return undefined;

    const entry = parseCSSCacheEntry(raw, DEFAULT_STYLESHEET);
    if (!isCSSCacheEntryForHash(entry, hash)) return undefined;
    storeInLocalCache(hash, entry);
    return entry;
  } catch (error) {
    logger.debug("Failed to read CSS cache entry", { hash, error });
  }

  return undefined;
}

/**
 * Get CSS generation inputs by hash for JIT regeneration.
 */
async function getCSSInputsByHash(hash: string): Promise<CSSInputsCacheEntry | undefined> {
  if (!isCSSContentHash(hash)) return undefined;

  const local = localCssInputsCache.get(hash);
  if (local) return local;

  try {
    const cache = await getCssInputsCache();
    const raw = await cache.get(getVersionedCacheKey(hash));
    if (!raw) return undefined;

    const entry = parseCSSInputsCacheEntry(raw);
    if (!entry) return undefined;
    storeInLocalCssInputsCache(hash, entry);
    logger.debug("CSS inputs cache hit from distributed cache", { hash });
    return entry;
  } catch (error) {
    logger.debug("Failed to read CSS inputs from distributed cache", { hash, error });
    return undefined;
  }
}

function toCSSInputsEntry(cacheEntry: CSSCacheEntry | undefined): CSSInputsCacheEntry | undefined {
  if (!cacheEntry || cacheEntry.candidates.length === 0) return undefined;
  return {
    candidates: cacheEntry.candidates,
    stylesheet: cacheEntry.stylesheet,
  };
}

/**
 * Resolve regeneration inputs from unified or legacy cache.
 * Tries unified cache (CSS + inputs together) first, then falls back to
 * legacy separate inputs cache for backward compatibility.
 */
export async function resolveRegenerationInputs(
  expectedHash: string,
): Promise<CSSInputsCacheEntry | undefined> {
  const unifiedEntry = await getCSSCacheEntry(expectedHash);
  const unifiedInputs = toCSSInputsEntry(unifiedEntry);
  if (unifiedInputs) {
    logger.debug("Found inputs in unified CSS cache", { hash: expectedHash });
    return unifiedInputs;
  }

  return await getCSSInputsByHash(expectedHash);
}

/**
 * Persist a regenerated CSS entry to both local and distributed caches.
 */
export async function persistRegeneratedCSSEntry(
  hash: string,
  entry: CSSCacheEntry,
): Promise<void> {
  assertCSSContentIdentity(entry.css, hash);
  storeInLocalCache(hash, entry);

  try {
    const cache = await getCssCache();
    await cache.set(getVersionedCacheKey(hash), JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.error("CSS cache write failed", {
      hash: hash.slice(-20),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
