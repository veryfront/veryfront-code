/**
 * SSR Module Loader Constants
 *
 * Configuration constants for the SSR module loading system.
 *
 * @module module-system/react-loader/ssr-module-loader/constants
 */

import { getSsrMaxConcurrentTransformsEnv } from "#veryfront/config/env.ts";

/** Maximum entries in the module cache */
export const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;

/** Module cache TTL in milliseconds (30 minutes) */
export const SSR_MODULE_CACHE_TTL_MS = 30 * 60 * 1000;

/** Maximum entries in the tmp dirs cache */
export const SSR_TMP_DIRS_MAX_ENTRIES = 100;

/** Redis key prefix for SSR modules */
export const REDIS_KEY_PREFIX = "veryfront:ssr-module:";

/** Redis TTL in seconds (30 minutes) */
export const REDIS_TTL_SECONDS = 1800;

/** Circuit breaker failure threshold */
export const CIRCUIT_BREAKER_THRESHOLD = 3;

/** Circuit breaker reset window in milliseconds (1 minute) */
export const CIRCUIT_BREAKER_RESET_MS = 60 * 1000;

/**
 * Maximum concurrent ESM transforms.
 * Configurable via SSR_MAX_CONCURRENT_TRANSFORMS env var.
 *
 * This is a SAFETY NET, not a throttle. Set high to allow burst capacity.
 * The real protection comes from:
 * - Caching (99%+ hit rate eliminates transforms)
 * - Horizontal scaling (more pods)
 * - Memory limits (OOM kill restarts unhealthy pods)
 *
 * Default: 50 (high enough for bursts, low enough to prevent OOM)
 * Set to 0 to disable the semaphore entirely.
 */
export const MAX_CONCURRENT_TRANSFORMS = parseInt(
  String(getSsrMaxConcurrentTransformsEnv(50)),
  10,
);

/** Timeout for acquiring a transform semaphore permit (ms) */
export const TRANSFORM_ACQUIRE_TIMEOUT_MS = 500;
