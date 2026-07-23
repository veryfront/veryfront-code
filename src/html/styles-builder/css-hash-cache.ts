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
import { hashCSS } from "./candidate-extractor.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import {
  buildCSSCacheEntry,
  parseCSSCacheEntry,
  resolveStylesheet,
} from "./tailwind-compiler-utils.ts";
import {
  MAX_CSS_CANDIDATE_BYTES,
  MAX_CSS_CANDIDATES,
  MAX_GENERATED_CSS_BYTES,
  MAX_LOCAL_CSS_INPUTS_CACHE_BYTES,
  MAX_LOCAL_HASH_CSS_CACHE_BYTES,
  MAX_STYLESHEET_BYTES,
  MAX_TOTAL_CSS_CANDIDATE_BYTES,
  utf8ByteLength,
} from "./resource-limits.ts";

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
const CACHE_HASH_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "UnknownError";
}

function validInputs(entry: CSSInputsCacheEntry): boolean {
  if (
    utf8ByteLength(entry.stylesheet) > MAX_STYLESHEET_BYTES ||
    entry.candidates.length > MAX_CSS_CANDIDATES
  ) return false;

  let totalBytes = 0;
  for (const candidate of entry.candidates) {
    if (typeof candidate !== "string") return false;
    const candidateBytes = utf8ByteLength(candidate);
    if (candidateBytes > MAX_CSS_CANDIDATE_BYTES) return false;
    totalBytes += candidateBytes;
    if (totalBytes > MAX_TOTAL_CSS_CANDIDATE_BYTES) return false;
  }
  return true;
}

function validCacheEntry(entry: CSSCacheEntry): boolean {
  return utf8ByteLength(entry.css) <= MAX_GENERATED_CSS_BYTES && validInputs(entry);
}

function assertCacheWrite(hash: string, entry: CSSCacheEntry): void {
  if (!CACHE_HASH_PATTERN.test(hash)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid CSS cache hash" });
  }
  if (!validCacheEntry(entry)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid CSS cache entry" });
  }
}

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
      logger.warn(options.initFailureLog, { error: errorName(error) });
      const fallback = new MemoryCacheBackend(options.localFallbackSize);
      options.setCache(fallback);
      return fallback;
    }
  })();

  options.setCacheInitPromise(initPromise);
  return initPromise;
}

// ============================================================================
// CSS cache state
// ============================================================================

let cssCache: CacheBackend | null = null;
let cssCacheInitPromise: Promise<CacheBackend> | null = null;

const localCssCache = new LRUCache<string, CSSCacheEntry>({
  maxEntries: LOCAL_CACHE_MAX_SIZE,
  maxSizeBytes: MAX_LOCAL_HASH_CSS_CACHE_BYTES,
});

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
  localCssCache.set(hash, entry);
}

// ============================================================================
// CSS inputs cache state
// ============================================================================

let cssInputsCache: CacheBackend | null = null;
let cssInputsCacheInitPromise: Promise<CacheBackend> | null = null;
const localCssInputsCache = new LRUCache<string, CSSInputsCacheEntry>({
  maxEntries: LOCAL_CSS_INPUTS_CACHE_MAX,
  maxSizeBytes: MAX_LOCAL_CSS_INPUTS_CACHE_BYTES,
});

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
  localCssInputsCache.set(hash, entry);
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
  const resolvedHash = hash ?? hashCSS(css);
  const entry: CSSCacheEntry = buildCSSCacheEntry(css, inputs, DEFAULT_STYLESHEET);
  assertCacheWrite(resolvedHash, entry);

  storeInLocalCache(resolvedHash, entry);

  try {
    const cache = await getCssCache();
    await cache.set(resolvedHash, JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("Failed to store CSS in distributed cache", {
      error: errorName(error),
    });
  }

  return resolvedHash;
}

export function getCSSByHash(hash: string): string | undefined {
  if (!CACHE_HASH_PATTERN.test(hash)) return undefined;
  const entry = localCssCache.get(hash);
  return entry?.css;
}

export async function getCSSByHashAsync(hash: string): Promise<string | undefined> {
  if (!CACHE_HASH_PATTERN.test(hash)) return undefined;
  return await withSpan(
    SpanNames.HTML_GET_CSS_BY_HASH,
    async () => {
      const local = localCssCache.get(hash);
      if (local) {
        return local.css;
      }

      try {
        const cache = await getCssCache();
        const raw = await cache.get(hash);
        if (!raw) return undefined;

        const entry = parseCSSCacheEntry(raw, DEFAULT_STYLESHEET);
        if (!validCacheEntry(entry)) return undefined;

        storeInLocalCache(hash, entry);
        logger.debug("CSS cache hit from distributed cache");
        return entry.css;
      } catch (error) {
        logger.debug("Failed to read from distributed CSS cache", { error: errorName(error) });
        return undefined;
      }
    },
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
  const entry: CSSInputsCacheEntry = {
    candidates: [...inputs.candidates],
    stylesheet: resolveStylesheet(inputs.stylesheet, DEFAULT_STYLESHEET),
  };
  if (!CACHE_HASH_PATTERN.test(hash) || !validInputs(entry)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid CSS inputs cache entry" });
  }

  storeInLocalCssInputsCache(hash, entry);

  try {
    const cache = await getCssInputsCache();
    await cache.set(hash, JSON.stringify(entry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.debug("Failed to store CSS inputs in distributed cache", {
      error: errorName(error),
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
  if (!CACHE_HASH_PATTERN.test(hash)) return undefined;
  const local = localCssCache.get(hash);
  if (local && local.candidates.length > 0) {
    return local;
  }

  try {
    const cache = await getCssCache();
    const raw = await cache.get(hash);
    if (!raw) return undefined;

    const entry = parseCSSCacheEntry(raw, DEFAULT_STYLESHEET);
    if (!validCacheEntry(entry)) return undefined;
    storeInLocalCache(hash, entry);
    return entry;
  } catch (error) {
    logger.debug("Failed to read CSS cache entry", { error: errorName(error) });
  }

  return undefined;
}

/**
 * Get CSS generation inputs by hash for JIT regeneration.
 */
async function getCSSInputsByHash(hash: string): Promise<CSSInputsCacheEntry | undefined> {
  if (!CACHE_HASH_PATTERN.test(hash)) return undefined;
  const local = localCssInputsCache.get(hash);
  if (local) {
    return copyCSSInputs(local);
  }

  try {
    const cache = await getCssInputsCache();
    const raw = await cache.get(hash);
    if (!raw) return undefined;

    if (raw.length > MAX_STYLESHEET_BYTES + MAX_TOTAL_CSS_CANDIDATE_BYTES + 4096) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as Partial<CSSInputsCacheEntry>;
    if (!Array.isArray(parsed.candidates) || typeof parsed.stylesheet !== "string") {
      return undefined;
    }
    const entry: CSSInputsCacheEntry = {
      candidates: parsed.candidates as string[],
      stylesheet: parsed.stylesheet,
    };
    if (!validInputs(entry)) return undefined;
    storeInLocalCssInputsCache(hash, entry);
    logger.debug("CSS inputs cache hit from distributed cache");
    return copyCSSInputs(entry);
  } catch (error) {
    logger.debug("Failed to read CSS inputs from distributed cache", { error: errorName(error) });
    return undefined;
  }
}

function toCSSInputsEntry(cacheEntry: CSSCacheEntry | undefined): CSSInputsCacheEntry | undefined {
  if (!cacheEntry || cacheEntry.candidates.length === 0) return undefined;
  return copyCSSInputs(cacheEntry);
}

function copyCSSInputs(entry: CSSInputsCacheEntry): CSSInputsCacheEntry {
  return {
    candidates: [...entry.candidates],
    stylesheet: entry.stylesheet,
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
    logger.debug("Found inputs in unified CSS cache");
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
  const safeEntry: CSSCacheEntry = {
    css: entry.css,
    candidates: [...entry.candidates],
    stylesheet: entry.stylesheet,
  };
  assertCacheWrite(hash, safeEntry);
  storeInLocalCache(hash, safeEntry);

  try {
    const cache = await getCssCache();
    await cache.set(hash, JSON.stringify(safeEntry), CSS_CACHE_TTL_SECONDS);
  } catch (error) {
    logger.error("CSS cache write failed", {
      error: errorName(error),
    });
  }
}
