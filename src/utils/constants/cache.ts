export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
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
  } catch {
    // Gracefully handle missing --allow-env permission in Deno
    return undefined;
  }
}

function getEnvNumber(key: string, fallback: number): number {
  const value = getEnvString(key);
  if (value == null) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function isProductionMode(): boolean {
  return getEnvString("PROXY_MODE") === "1" ||
    getEnvString("NODE_ENV") === "production" ||
    getEnvString("PRODUCTION_MODE") === "1";
}

// Cache entry limits (override via env vars)
export const DEFAULT_LRU_MAX_ENTRIES = getEnvNumber("LRU_DEFAULT_MAX_ENTRIES", 100);

export const COMPONENT_LOADER_MAX_ENTRIES = getEnvNumber("COMPONENT_LOADER_MAX_ENTRIES", 200);
export const COMPONENT_LOADER_TTL_MS = 10 * MS_PER_MINUTE;

export const MDX_RENDERER_MAX_ENTRIES = getEnvNumber("MDX_RENDERER_MAX_ENTRIES", 500);
export const MDX_RENDERER_TTL_MS = 10 * MS_PER_MINUTE;

export const RENDERER_CORE_MAX_ENTRIES = getEnvNumber("RENDERER_CORE_MAX_ENTRIES", 200);
export const RENDERER_CORE_TTL_MS = 5 * MS_PER_MINUTE;

export const TSX_LAYOUT_MAX_ENTRIES = getEnvNumber("TSX_LAYOUT_MAX_ENTRIES", 100);
export const TSX_LAYOUT_TTL_MS = 10 * MS_PER_MINUTE;

export const DATA_FETCHING_MAX_ENTRIES = getEnvNumber("DATA_FETCHING_MAX_ENTRIES", 500);
export const DATA_FETCHING_TTL_MS = 10 * MS_PER_MINUTE;

export const MDX_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const MDX_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const BUNDLE_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_MANIFEST_PROD_TTL_MS = 7 * ONE_DAY_MS;
export const BUNDLE_MANIFEST_DEV_TTL_MS = MS_PER_HOUR;

export const RSC_MANIFEST_CACHE_TTL_MS = 5000;

export const SERVER_ACTION_DEFAULT_TTL_SEC = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

// Distributed cache TTL (Redis/API)
// Production: longer TTLs (release content is immutable)
// Preview: shorter TTLs (branch content changes frequently)

export const DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC = getEnvNumber(
  "DISTRIBUTED_SSR_MODULE_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC = getEnvNumber(
  "DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);

export const DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC = getEnvNumber(
  "DISTRIBUTED_TRANSFORM_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC = getEnvNumber(
  "DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);

export const DISTRIBUTED_FILE_TTL_PRODUCTION_SEC = getEnvNumber(
  "DISTRIBUTED_FILE_TTL_SEC",
  MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_FILE_TTL_PREVIEW_SEC = getEnvNumber(
  "DISTRIBUTED_FILE_TTL_PREVIEW_SEC",
  5 * SECONDS_PER_MINUTE,
);

export const DISTRIBUTED_CSS_TTL_PRODUCTION_SEC = getEnvNumber(
  "DISTRIBUTED_CSS_TTL_SEC",
  6 * MINUTES_PER_HOUR * SECONDS_PER_MINUTE,
);
export const DISTRIBUTED_CSS_TTL_PREVIEW_SEC = getEnvNumber(
  "DISTRIBUTED_CSS_TTL_PREVIEW_SEC",
  10 * SECONDS_PER_MINUTE,
);

/** Get environment-aware distributed cache TTL in seconds */
export function getDistributedCacheTTL(
  cacheType: "ssr-module" | "transform" | "file" | "css",
  isProduction: boolean = isProductionMode(),
): number {
  switch (cacheType) {
    case "ssr-module":
      return isProduction
        ? DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC
        : DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC;
    case "transform":
      return isProduction
        ? DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC
        : DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC;
    case "file":
      return isProduction ? DISTRIBUTED_FILE_TTL_PRODUCTION_SEC : DISTRIBUTED_FILE_TTL_PREVIEW_SEC;
    case "css":
      return isProduction ? DISTRIBUTED_CSS_TTL_PRODUCTION_SEC : DISTRIBUTED_CSS_TTL_PREVIEW_SEC;
  }
}

// Size limits (override via env vars)
export const DENO_KV_SAFE_SIZE_LIMIT_BYTES = 64_000;
export const LRU_DEFAULT_MAX_ENTRIES_V2 = getEnvNumber("LRU_MAX_ENTRIES", 2000);
export const LRU_DEFAULT_MAX_SIZE_BYTES = getEnvNumber("LRU_MAX_SIZE_MB", 200) * 1024 * 1024;
export const MEMORY_CACHE_MAX_ENTRIES = getEnvNumber("MEMORY_CACHE_MAX_ENTRIES", 2000);
export const FILE_CACHE_MAX_ENTRIES = getEnvNumber("FILE_CACHE_MAX_ENTRIES", 1000);
export const FILE_CACHE_MAX_SIZE_MB = getEnvNumber("FILE_CACHE_MAX_SIZE_MB", 100);

// HTTP cache headers
export const HTTP_CACHE_SHORT_MAX_AGE_SEC = 60;
export const HTTP_CACHE_MEDIUM_MAX_AGE_SEC = 3600;
export const HTTP_CACHE_LONG_MAX_AGE_SEC = 31536000;

// Maintenance
export const CACHE_CLEANUP_INTERVAL_MS = 60000;
export const CLEANUP_INTERVAL_MULTIPLIER = 2;

// Concurrency limits (override via env vars)
export const MAX_CONCURRENT_REVALIDATIONS = getEnvNumber("MAX_CONCURRENT_REVALIDATIONS", 32);
export const MAX_CONCURRENT_HTTP_FETCHES = getEnvNumber("MAX_CONCURRENT_HTTP_FETCHES", 50);
export const REVALIDATION_TIMEOUT_MS = getEnvNumber("REVALIDATION_TIMEOUT_MS", 15000);

// Per-project fairness limit for revalidations (prevents one project from starving others)
export const REVALIDATION_PER_PROJECT_LIMIT = getEnvNumber(
  "REVALIDATION_PER_PROJECT_LIMIT",
  Math.ceil(MAX_CONCURRENT_REVALIDATIONS / 3),
);

// Bundle manifest for atomic HTTP bundle group validation
export const BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC = getEnvNumber(
  "BUNDLE_MANIFEST_DISTRIBUTED_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);
export const BUNDLE_MANIFEST_LRU_MAX_ENTRIES = getEnvNumber(
  "BUNDLE_MANIFEST_LRU_MAX_ENTRIES",
  5000,
);

// HTTP module cache (esm.sh, CDN bundles)
// These bundles are immutable once fetched, so long TTLs are safe
export const HTTP_MODULE_CACHE_MAX_ENTRIES = getEnvNumber("HTTP_MODULE_CACHE_MAX_ENTRIES", 2000);
export const HTTP_MODULE_DISTRIBUTED_TTL_SEC = getEnvNumber(
  "HTTP_MODULE_DISTRIBUTED_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);

// Transform cache for module compilation
// Same TTL as HTTP module cache since transforms are tied to content hashes
export const TRANSFORM_DISTRIBUTED_TTL_SEC = getEnvNumber(
  "TRANSFORM_DISTRIBUTED_TTL_SEC",
  HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE, // 24 hours (86400)
);

// Pod-level module cache (shared across all RenderPipeline instances)
// These caches map module paths to transformed temp file paths
export const MODULE_CACHE_MAX_ENTRIES = getEnvNumber("MODULE_CACHE_MAX_ENTRIES", 10000);
export const MODULE_CACHE_TTL_MS = getEnvNumber(
  "MODULE_CACHE_TTL_MS",
  5 * MS_PER_MINUTE, // 5 minutes - short enough to pick up changes, long enough to cache
);

// ESM cache for external module mappings
export const ESM_CACHE_MAX_ENTRIES = getEnvNumber("ESM_CACHE_MAX_ENTRIES", 5000);
export const ESM_CACHE_TTL_MS = getEnvNumber(
  "ESM_CACHE_TTL_MS",
  10 * MS_PER_MINUTE, // 10 minutes - external modules change less frequently
);
