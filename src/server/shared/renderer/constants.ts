/**
 * Renderer Factory Constants
 * @module server/shared/renderer/constants
 */

/**
 * Maximum number of renderer instances to cache.
 * When exceeded, least recently used renderers are evicted.
 * Reduced from 15 to 10 to leave more headroom for Deno internals.
 */
export const MAX_RENDERER_CACHE_SIZE = 10;

/**
 * TTL for cached renderers (30 minutes).
 * Renderers not accessed within this time are eligible for eviction.
 */
export const RENDERER_TTL_MS = 30 * 60 * 1000;

/**
 * Memory pressure thresholds (percentage of heap limit).
 * When heap usage exceeds these thresholds, aggressive eviction kicks in.
 */
export const MEMORY_PRESSURE_WARNING = 70; // Start evicting 50% of cache
export const MEMORY_PRESSURE_CRITICAL = 85; // Emergency: keep only 2 renderers

/**
 * Interval for periodic memory pressure checks (30 seconds).
 * This catches slow memory growth even when no new renderers are being created.
 */
export const MEMORY_CHECK_INTERVAL_MS = 30 * 1000;
