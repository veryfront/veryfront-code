import { getSsrMaxConcurrentTransformsEnv } from "#veryfront/config/env.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC,
  DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC,
  getDistributedCacheTTL,
  MS_PER_MINUTE,
} from "#veryfront/utils/constants/cache.ts";

export const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
export const SSR_MODULE_CACHE_TTL_MS = 30 * MS_PER_MINUTE;

export const SSR_TMP_DIRS_MAX_ENTRIES = 100;
export const FAILED_COMPONENT_CACHE_MAX_ENTRIES = 2_000;
export const MAX_PROJECT_TRANSFORM_WAITERS = 100;

export const REDIS_KEY_PREFIX = "veryfront:ssr-module:";

/** Get environment-aware Redis TTL for SSR modules */
export function getSSRModuleRedisTTL(isProduction: boolean): number {
  return getDistributedCacheTTL("ssr-module", isProduction);
}

export { DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC };

export const CIRCUIT_BREAKER_THRESHOLD = 25;
export const CIRCUIT_BREAKER_RESET_MS = 5 * 1000;

// Max concurrent ESM transforms (safety net, not throttle). Set to 0 to disable.
let _maxConcurrentTransforms: number | undefined;
export function getMaxConcurrentTransforms(): number {
  if (_maxConcurrentTransforms !== undefined) return _maxConcurrentTransforms;
  const configured = getSsrMaxConcurrentTransformsEnv(50);
  _maxConcurrentTransforms = Number.isSafeInteger(configured) && configured >= 0 ? configured : 50;
  return _maxConcurrentTransforms;
}

/**
 * Maximum concurrent transforms per project (noisy-neighbor protection).
 * Defaults to ceil(MAX_CONCURRENT_TRANSFORMS / 3) so no single project can consume
 * more than ~1/3 of transform capacity. Set to 0 to disable per-project limits.
 * Configurable via SSR_TRANSFORM_PER_PROJECT_LIMIT env var.
 */
let _transformPerProjectLimit: number | undefined;
export function getTransformPerProjectLimit(): number {
  if (_transformPerProjectLimit !== undefined) return _transformPerProjectLimit;
  const envLimit = getHostEnv("SSR_TRANSFORM_PER_PROJECT_LIMIT");
  const defaultLimit = Math.ceil(getMaxConcurrentTransforms() / 3);
  if (envLimit === undefined || envLimit.trim() === "") {
    _transformPerProjectLimit = defaultLimit;
    return _transformPerProjectLimit;
  }

  const parsed = Number(envLimit);
  _transformPerProjectLimit = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : defaultLimit;
  return _transformPerProjectLimit;
}

/** Reset cached transform limits so env var changes take effect. */
export function resetCachedTransformLimits(): void {
  _maxConcurrentTransforms = undefined;
  _transformPerProjectLimit = undefined;
}

export const TRANSFORM_ACQUIRE_TIMEOUT_MS = 500;
export const IN_PROGRESS_WAIT_TIMEOUT_MS = 30_000;

export const MAX_TRANSFORM_DEPTH = 15;
export const TRANSFORM_BATCH_SIZE = 10;
export const MAX_SSR_IMPORTS_PER_MODULE = 5_000;
