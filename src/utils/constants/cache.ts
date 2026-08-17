import { MAX_TIMER_DELAY_MS } from "./limits.ts";

export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
/** Shared ms per second value. */
export const MS_PER_SECOND = 1000;

export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const ONE_DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;

function getEnvString(key: string): string | undefined {
  const g = globalThis as {
    Deno?: { env?: { get?: (k: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };

  try {
    return g.Deno?.env?.get?.(key) ?? g.process?.env?.[key];
  } catch (_) {
    /* expected: Deno may deny --allow-env permission */
    return undefined;
  }
}

const MAX_CONFIGURED_CACHE_ENTRIES = 1_000_000;
const MAX_CONFIGURED_CACHE_SIZE_MB = 64 * 1024;
const MAX_CONFIGURED_CONCURRENCY = 10_000;
const MAX_CONFIGURED_TTL_SECONDS = 365 * HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
const BYTES_PER_MB = 1024 * 1024;

/**
 * Protocol-safe cache TTL upper bound (signed 32-bit seconds, roughly
 * 68 years). Its millisecond form can be added to a contemporary epoch
 * timestamp without exceeding Number.MAX_SAFE_INTEGER or the Date range.
 */
export const MAX_CACHE_TTL_SECONDS = 2_147_483_647;
export const MAX_CACHE_TTL_MILLISECONDS = MAX_CACHE_TTL_SECONDS * MS_PER_SECOND;

interface EnvIntegerOptions {
  min?: number;
  max: number;
}

function getEnvInteger(
  key: string,
  fallback: number,
  { min = 1, max }: EnvIntegerOptions,
): number {
  const value = getEnvString(key);
  if (value == null) return fallback;

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return fallback;

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;

  return parsed;
}

function getStrictEnvInteger(
  key: string,
  fallback: number,
  { min = 1, max }: EnvIntegerOptions,
): number {
  const value = getEnvString(key);
  if (value == null) return fallback;

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new RangeError(
      `${key} must be a base-10 integer between ${min} and ${max}`,
    );
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(`${key} must be between ${min} and ${max}`);
  }
  return parsed;
}

function getEnvCacheEntries(key: string, fallback: number): number {
  return getEnvInteger(key, fallback, { max: MAX_CONFIGURED_CACHE_ENTRIES });
}

function getEnvCacheSizeMb(key: string, fallback: number): number {
  return getEnvInteger(key, fallback, { max: MAX_CONFIGURED_CACHE_SIZE_MB });
}

function getEnvTtlSeconds(key: string, fallback: number): number {
  return getEnvInteger(key, fallback, { max: MAX_CONFIGURED_TTL_SECONDS });
}

function isProductionMode(): boolean {
  return (
    getEnvString("PROXY_MODE") === "1" ||
    getEnvString("NODE_ENV") === "production" ||
    getEnvString("PRODUCTION_MODE") === "1"
  );
}

// Cache entry limits (override via env vars)
/** Default value for lru max entries. */
export const DEFAULT_LRU_MAX_ENTRIES = getEnvCacheEntries("LRU_DEFAULT_MAX_ENTRIES", 100);

export const COMPONENT_LOADER_MAX_ENTRIES = getEnvCacheEntries("COMPONENT_LOADER_MAX_ENTRIES", 200);
export const COMPONENT_LOADER_TTL_MS = 10 * MS_PER_MINUTE;

export const MDX_RENDERER_MAX_ENTRIES = getEnvCacheEntries("MDX_RENDERER_MAX_ENTRIES", 500);
export const MDX_RENDERER_TTL_MS = 10 * MS_PER_MINUTE;

export const RENDERER_CORE_MAX_ENTRIES = getEnvCacheEntries("RENDERER_CORE_MAX_ENTRIES", 200);
export const RENDERER_CORE_TTL_MS = 5 * MS_PER_MINUTE;

/** Shared TSX layout max entries value. */
export const TSX_LAYOUT_MAX_ENTRIES = getEnvCacheEntries("TSX_LAYOUT_MAX_ENTRIES", 100);
export const TSX_LAYOUT_TTL_MS = 10 * MS_PER_MINUTE;

/**
 * Per-project cap for the TSX layout component cache.
 * Prevents a single noisy tenant from evicting every other project's
 * cached layouts. Defaults to ceil(TSX_LAYOUT_MAX_ENTRIES / 10) so no
 * one project consumes more than ~10 % of the global budget.
 * Set via TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES env var.
 */
export const TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES = getEnvCacheEntries(
  "TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES",
  Math.ceil(TSX_LAYOUT_MAX_ENTRIES / 10),
);

export const DATA_FETCHING_MAX_ENTRIES = getStrictEnvInteger(
  "DATA_FETCHING_MAX_ENTRIES",
  500,
  { max: MAX_CONFIGURED_CACHE_ENTRIES },
);
export const DATA_FETCHING_MAX_ENTRIES_PER_PROJECT = getStrictEnvInteger(
  "DATA_FETCHING_MAX_ENTRIES_PER_PROJECT",
  Math.max(1, Math.ceil(DATA_FETCHING_MAX_ENTRIES / 5)),
  { max: DATA_FETCHING_MAX_ENTRIES },
);

const dataFetchingMaxSizeMb = getStrictEnvInteger(
  "DATA_FETCHING_MAX_SIZE_MB",
  50,
  { max: MAX_CONFIGURED_CACHE_SIZE_MB },
);
export const DATA_FETCHING_MAX_SIZE_BYTES = dataFetchingMaxSizeMb * BYTES_PER_MB;
export const DATA_FETCHING_MAX_SIZE_BYTES_PER_PROJECT = getStrictEnvInteger(
  "DATA_FETCHING_MAX_SIZE_MB_PER_PROJECT",
  Math.max(1, Math.ceil(dataFetchingMaxSizeMb / 5)),
  { max: dataFetchingMaxSizeMb },
) * BYTES_PER_MB;
export const DATA_FETCHING_TTL_MS = 10 * MS_PER_MINUTE;

/**
 * Process-wide data-hook execution budget.
 *
 * Render admission alone is insufficient because a disconnected caller may
 * settle before its non-cooperative project hook. These limits stay occupied
 * until the underlying hook actually settles.
 */
export const DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS = getStrictEnvInteger(
  "DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS",
  512,
  { max: MAX_CONFIGURED_CONCURRENCY },
);
export const DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS_PER_PROJECT = getStrictEnvInteger(
  "DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS_PER_PROJECT",
  Math.min(128, DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS),
  { max: DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS },
);

export const MDX_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const MDX_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const BUNDLE_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_MANIFEST_PROD_TTL_MS = 7 * ONE_DAY_MS;
export const BUNDLE_MANIFEST_DEV_TTL_MS = MS_PER_HOUR;

/** Shared RSC manifest cache ttl ms value. */
export const RSC_MANIFEST_CACHE_TTL_MS = 5000;

export const SERVER_ACTION_DEFAULT_TTL_SEC = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

// Distributed cache TTL
// Production: longer TTLs (release content is immutable)
// Preview: shorter TTLs (branch content changes frequently)

export const DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_SSR_MODULE_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);
// A local dev server keeps compiled SSR modules on disk so a restart stays
// warm. The preview TTL above is tuned for a shared branch cache and expires
// long before you come back to the project, so local dev keeps entries for a
// working day instead.
export const LOCAL_DEV_SSR_MODULE_TTL_SEC = getEnvTtlSeconds(
  "LOCAL_DEV_SSR_MODULE_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);

export const DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_TRANSFORM_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);

export const DISTRIBUTED_FILE_TTL_PRODUCTION_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_FILE_TTL_SEC",
  MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_FILE_TTL_PREVIEW_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_FILE_TTL_PREVIEW_SEC",
  5 * SECONDS_PER_MINUTE,
);

export const DISTRIBUTED_CSS_TTL_PRODUCTION_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_CSS_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_CSS_TTL_PREVIEW_SEC = getEnvTtlSeconds(
  "DISTRIBUTED_CSS_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);

/** Get environment-aware distributed cache TTL in seconds */
export function getDistributedCacheTTL(
  cacheType: "ssr-module" | "transform" | "file" | "css",
  isProduction: boolean = isProductionMode(),
): number {
  if (cacheType === "ssr-module") {
    return isProduction
      ? DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC
      : DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC;
  }

  if (cacheType === "transform") {
    return isProduction
      ? DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC
      : DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC;
  }

  if (cacheType === "file") {
    return isProduction ? DISTRIBUTED_FILE_TTL_PRODUCTION_SEC : DISTRIBUTED_FILE_TTL_PREVIEW_SEC;
  }

  return isProduction ? DISTRIBUTED_CSS_TTL_PRODUCTION_SEC : DISTRIBUTED_CSS_TTL_PREVIEW_SEC;
}

// Size limits (override via env vars)
export const DENO_KV_SAFE_SIZE_LIMIT_BYTES = 64_000;
export const LRU_DEFAULT_MAX_ENTRIES_V2 = getEnvCacheEntries("LRU_MAX_ENTRIES", 2000);
export const LRU_DEFAULT_MAX_SIZE_BYTES = getEnvCacheSizeMb("LRU_MAX_SIZE_MB", 200) * BYTES_PER_MB;
export const MEMORY_CACHE_MAX_ENTRIES = getEnvCacheEntries("MEMORY_CACHE_MAX_ENTRIES", 2000);
export const MEMORY_CACHE_MAX_SIZE_BYTES = getEnvCacheSizeMb("MEMORY_CACHE_MAX_SIZE_MB", 50) *
  BYTES_PER_MB;
export const FILE_CACHE_MAX_ENTRIES = getEnvCacheEntries("FILE_CACHE_MAX_ENTRIES", 1000);
export const FILE_CACHE_MAX_SIZE_MB = getEnvCacheSizeMb("FILE_CACHE_MAX_SIZE_MB", 100);

// HTTP cache headers
export const HTTP_CACHE_SHORT_MAX_AGE_SEC = 60;
export const HTTP_CACHE_MEDIUM_MAX_AGE_SEC = 3600;
export const HTTP_CACHE_LONG_MAX_AGE_SEC = 31536000;

// Maintenance
export const CACHE_CLEANUP_INTERVAL_MS = 60000;
export const CLEANUP_INTERVAL_MULTIPLIER = 2;

// Concurrency limits (override via env vars)
export const MAX_CONCURRENT_REVALIDATIONS = getEnvInteger("MAX_CONCURRENT_REVALIDATIONS", 32, {
  max: MAX_CONFIGURED_CONCURRENCY,
});
export const MAX_CONCURRENT_HTTP_FETCHES = getEnvInteger("MAX_CONCURRENT_HTTP_FETCHES", 50, {
  max: MAX_CONFIGURED_CONCURRENCY,
});
export const REVALIDATION_TIMEOUT_MS = getEnvInteger("REVALIDATION_TIMEOUT_MS", 15000, {
  max: MAX_TIMER_DELAY_MS,
});

// Per-project fairness limit for revalidations (prevents one project from starving others)
export const REVALIDATION_PER_PROJECT_LIMIT = getEnvInteger(
  "REVALIDATION_PER_PROJECT_LIMIT",
  Math.ceil(MAX_CONCURRENT_REVALIDATIONS / 3),
  { min: 0, max: MAX_CONFIGURED_CONCURRENCY },
);

// Bundle manifest for atomic HTTP bundle group validation
export const BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC = getEnvTtlSeconds(
  "BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);
export const BUNDLE_MANIFEST_LRU_MAX_ENTRIES = getEnvCacheEntries(
  "BUNDLE_MANIFEST_LRU_MAX_ENTRIES",
  5000,
);
export const BUNDLE_MANIFEST_MEMORY_MAX_METADATA_SIZE_BYTES = getEnvCacheSizeMb(
  "BUNDLE_MANIFEST_MEMORY_MAX_METADATA_SIZE_MB",
  128,
) * BYTES_PER_MB;
export const BUNDLE_MANIFEST_MEMORY_MAX_CODE_SIZE_BYTES = getEnvCacheSizeMb(
  "BUNDLE_MANIFEST_MEMORY_MAX_CODE_SIZE_MB",
  256,
) * BYTES_PER_MB;

// HTTP module cache (esm.sh, CDN bundles)
// These bundles are immutable once fetched, so long TTLs are safe
export const HTTP_MODULE_CACHE_MAX_ENTRIES = getEnvCacheEntries(
  "HTTP_MODULE_CACHE_MAX_ENTRIES",
  2000,
);
export const HTTP_MODULE_DISTRIBUTED_TTL_SEC = getEnvTtlSeconds(
  "HTTP_MODULE_DISTRIBUTED_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);

// Transform cache for module compilation
// MUST be shorter than HTTP_MODULE_DISTRIBUTED_TTL_SEC (24h) so that
// HTTP bundles always outlive the transforms that reference them.
// 6h matches DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC used by the SSR loader.
export const TRANSFORM_DISTRIBUTED_TTL_SEC = getEnvTtlSeconds(
  "TRANSFORM_DISTRIBUTED_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 6 hours (21600)
);

// Pod-level module cache (shared across all RenderPipeline instances)
// These caches map module paths to transformed temp file paths
export const MODULE_CACHE_MAX_ENTRIES = getEnvCacheEntries("MODULE_CACHE_MAX_ENTRIES", 10000);
export const MODULE_CACHE_TTL_MS = getEnvInteger(
  "MODULE_CACHE_TTL_MS",
  5 * MS_PER_MINUTE, // 5 minutes - short enough to pick up changes, long enough to cache
  { max: MAX_TIMER_DELAY_MS },
);

// ESM cache for external module mappings
export const ESM_CACHE_MAX_ENTRIES = getEnvCacheEntries("ESM_CACHE_MAX_ENTRIES", 5000);
export const ESM_CACHE_TTL_MS = getEnvInteger(
  "ESM_CACHE_TTL_MS",
  10 * MS_PER_MINUTE, // 10 minutes - external modules change less frequently
  { max: MAX_TIMER_DELAY_MS },
);
