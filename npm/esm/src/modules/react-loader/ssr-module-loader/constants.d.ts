import { DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC } from "../../../utils/constants/cache.js";
export declare const SSR_MODULE_CACHE_MAX_ENTRIES = 2000;
export declare const SSR_MODULE_CACHE_TTL_MS: number;
export declare const SSR_TMP_DIRS_MAX_ENTRIES = 100;
export declare const REDIS_KEY_PREFIX = "veryfront:ssr-module:";
/** @deprecated Use getSSRModuleRedisTTL() for environment-aware TTL */
export declare const REDIS_TTL_SECONDS: number;
/** Get environment-aware Redis TTL for SSR modules */
export declare function getSSRModuleRedisTTL(isProduction: boolean): number;
export { DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC, DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC };
export declare const CIRCUIT_BREAKER_THRESHOLD = 3;
export declare const CIRCUIT_BREAKER_RESET_MS: number;
export declare const MAX_CONCURRENT_TRANSFORMS: number;
export declare const TRANSFORM_ACQUIRE_TIMEOUT_MS = 500;
export declare const IN_PROGRESS_WAIT_TIMEOUT_MS = 30000;
export declare const MAX_TRANSFORM_DEPTH = 15;
export declare const TRANSFORM_BATCH_SIZE = 10;
//# sourceMappingURL=constants.d.ts.map