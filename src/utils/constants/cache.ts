// Time constants
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MS_PER_SECOND = 1000;

export const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
export const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
export const ONE_DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;

/** Get env var as number with fallback (works in Deno and Node) */
function getEnvNumber(key: string, fallback: number): number {
  const g = globalThis as {
    Deno?: { env?: { get?: (k: string) => string | undefined } };
    process?: { env?: Record<string, string | undefined> };
  };

  const value = g.Deno?.env?.get?.(key) ?? g.process?.env?.[key];
  if (value == null) return fallback;

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// ============================================================================
// CACHE ENTRY LIMITS (configurable via env vars for high-traffic scaling)
// ============================================================================

/** Default LRU max entries - override with LRU_DEFAULT_MAX_ENTRIES env var */
export const DEFAULT_LRU_MAX_ENTRIES = getEnvNumber("LRU_DEFAULT_MAX_ENTRIES", 100);

/** Component loader cache - override with COMPONENT_LOADER_MAX_ENTRIES env var */
export const COMPONENT_LOADER_MAX_ENTRIES = getEnvNumber("COMPONENT_LOADER_MAX_ENTRIES", 200);
export const COMPONENT_LOADER_TTL_MS = 10 * MS_PER_MINUTE;

/** MDX renderer cache - override with MDX_RENDERER_MAX_ENTRIES env var */
export const MDX_RENDERER_MAX_ENTRIES = getEnvNumber("MDX_RENDERER_MAX_ENTRIES", 500);
export const MDX_RENDERER_TTL_MS = 10 * MS_PER_MINUTE;

/** Renderer core cache - override with RENDERER_CORE_MAX_ENTRIES env var */
export const RENDERER_CORE_MAX_ENTRIES = getEnvNumber("RENDERER_CORE_MAX_ENTRIES", 200);
export const RENDERER_CORE_TTL_MS = 5 * MS_PER_MINUTE;

/** TSX layout cache - override with TSX_LAYOUT_MAX_ENTRIES env var */
export const TSX_LAYOUT_MAX_ENTRIES = getEnvNumber("TSX_LAYOUT_MAX_ENTRIES", 100);
export const TSX_LAYOUT_TTL_MS = 10 * MS_PER_MINUTE;

/** Data fetching cache - override with DATA_FETCHING_MAX_ENTRIES env var */
export const DATA_FETCHING_MAX_ENTRIES = getEnvNumber("DATA_FETCHING_MAX_ENTRIES", 500);
export const DATA_FETCHING_TTL_MS = 10 * MS_PER_MINUTE;

// ============================================================================
// CACHE TTL SETTINGS
// ============================================================================

export const MDX_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const MDX_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_CACHE_TTL_PRODUCTION_MS = ONE_DAY_MS;
export const BUNDLE_CACHE_TTL_DEVELOPMENT_MS = 5 * MS_PER_MINUTE;

export const BUNDLE_MANIFEST_PROD_TTL_MS = 7 * ONE_DAY_MS;
export const BUNDLE_MANIFEST_DEV_TTL_MS = MS_PER_HOUR;

export const RSC_MANIFEST_CACHE_TTL_MS = 5000;

export const SERVER_ACTION_DEFAULT_TTL_SEC = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;

// ============================================================================
// SIZE LIMITS (configurable via env vars for high-traffic scaling)
// ============================================================================

export const DENO_KV_SAFE_SIZE_LIMIT_BYTES = 64_000;

/** LRU max entries - override with LRU_MAX_ENTRIES env var */
export const LRU_DEFAULT_MAX_ENTRIES_V2 = getEnvNumber("LRU_MAX_ENTRIES", 2000);

/** LRU max size in bytes - override with LRU_MAX_SIZE_MB env var (default 200MB) */
export const LRU_DEFAULT_MAX_SIZE_BYTES = getEnvNumber("LRU_MAX_SIZE_MB", 200) * 1024 * 1024;

/** Memory cache max entries - override with MEMORY_CACHE_MAX_ENTRIES env var */
export const MEMORY_CACHE_MAX_ENTRIES = getEnvNumber("MEMORY_CACHE_MAX_ENTRIES", 2000);

/** File cache fallback max entries - override with FILE_CACHE_MAX_ENTRIES env var */
export const FILE_CACHE_MAX_ENTRIES = getEnvNumber("FILE_CACHE_MAX_ENTRIES", 1000);

/** File cache fallback max size in MB - override with FILE_CACHE_MAX_SIZE_MB env var */
export const FILE_CACHE_MAX_SIZE_MB = getEnvNumber("FILE_CACHE_MAX_SIZE_MB", 100);

// ============================================================================
// HTTP CACHE HEADERS
// ============================================================================

export const HTTP_CACHE_SHORT_MAX_AGE_SEC = 60;
export const HTTP_CACHE_MEDIUM_MAX_AGE_SEC = 3600;
export const HTTP_CACHE_LONG_MAX_AGE_SEC = 31536000;

// ============================================================================
// MAINTENANCE
// ============================================================================

export const CACHE_CLEANUP_INTERVAL_MS = 60000;
export const CLEANUP_INTERVAL_MULTIPLIER = 2;

// ============================================================================
// CONCURRENCY LIMITS (for high-traffic protection)
// ============================================================================

/** Max concurrent revalidations - override with MAX_CONCURRENT_REVALIDATIONS env var */
export const MAX_CONCURRENT_REVALIDATIONS = getEnvNumber("MAX_CONCURRENT_REVALIDATIONS", 32);

/** Max concurrent HTTP module fetches - override with MAX_CONCURRENT_HTTP_FETCHES env var */
export const MAX_CONCURRENT_HTTP_FETCHES = getEnvNumber("MAX_CONCURRENT_HTTP_FETCHES", 50);

/** Revalidation timeout in ms - override with REVALIDATION_TIMEOUT_MS env var */
export const REVALIDATION_TIMEOUT_MS = getEnvNumber("REVALIDATION_TIMEOUT_MS", 15000);
