import { getSsrMaxConcurrentTransformsEnv } from "#veryfront/config/env.ts";
import {
  DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
  DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC,
  getDistributedCacheTTL,
  MS_PER_MINUTE,
} from "#veryfront/utils/constants/cache.ts";

export const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
export const SSR_MODULE_CACHE_TTL_MS = 30 * MS_PER_MINUTE;

export const SSR_TMP_DIRS_MAX_ENTRIES = 100;

export const REDIS_KEY_PREFIX = "veryfront:ssr-module:";

/**
 * Redis TTL for SSR modules.
 * Uses environment-aware defaults:
 * - Production: 6 hours (release content is immutable)
 * - Preview: 10 minutes (branch content changes frequently)
 *
 * @deprecated Use getSSRModuleRedisTTL() for environment-aware TTL
 */
export const REDIS_TTL_SECONDS = DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC;

/**
 * Get environment-aware Redis TTL for SSR modules.
 * @param isProduction Whether serving production (release-based) content
 */
export function getSSRModuleRedisTTL(isProduction: boolean): number {
  return getDistributedCacheTTL("ssr-module", isProduction);
}

// Re-export for convenience
export {
  DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
  DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC,
};

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
