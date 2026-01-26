import { getSsrMaxConcurrentTransformsEnv } from "../../../config/env.js";
import { DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC, getDistributedCacheTTL, MS_PER_MINUTE, } from "../../../utils/constants/cache.js";
export const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
export const SSR_MODULE_CACHE_TTL_MS = 30 * MS_PER_MINUTE;
export const SSR_TMP_DIRS_MAX_ENTRIES = 100;
export const REDIS_KEY_PREFIX = "veryfront:ssr-module:";
/** @deprecated Use getSSRModuleRedisTTL() for environment-aware TTL */
export const REDIS_TTL_SECONDS = DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC;
/** Get environment-aware Redis TTL for SSR modules */
export function getSSRModuleRedisTTL(isProduction) {
    return getDistributedCacheTTL("ssr-module", isProduction);
}
export { DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC };
export const CIRCUIT_BREAKER_THRESHOLD = 3;
export const CIRCUIT_BREAKER_RESET_MS = 60 * 1000;
// Max concurrent ESM transforms (safety net, not throttle). Set to 0 to disable.
export const MAX_CONCURRENT_TRANSFORMS = Number.parseInt(String(getSsrMaxConcurrentTransformsEnv(50)), 10);
export const TRANSFORM_ACQUIRE_TIMEOUT_MS = 500;
export const IN_PROGRESS_WAIT_TIMEOUT_MS = 30_000;
export const MAX_TRANSFORM_DEPTH = 15;
export const TRANSFORM_BATCH_SIZE = 10;
