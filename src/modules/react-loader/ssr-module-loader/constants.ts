import { getSsrMaxConcurrentTransformsEnv } from "#veryfront/config/env.ts";

export const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
export const SSR_MODULE_CACHE_TTL_MS = 30 * 60 * 1000;

export const SSR_TMP_DIRS_MAX_ENTRIES = 100;

export const REDIS_KEY_PREFIX = "veryfront:ssr-module:";
export const REDIS_TTL_SECONDS = 1800;

export const CIRCUIT_BREAKER_THRESHOLD = 3;
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
export const MAX_CONCURRENT_TRANSFORMS = Number.parseInt(
  String(getSsrMaxConcurrentTransformsEnv(50)),
  10,
);

export const TRANSFORM_ACQUIRE_TIMEOUT_MS = 500;
export const IN_PROGRESS_WAIT_TIMEOUT_MS = 30_000;

export const MAX_TRANSFORM_DEPTH = 15;
export const TRANSFORM_BATCH_SIZE = 10;
