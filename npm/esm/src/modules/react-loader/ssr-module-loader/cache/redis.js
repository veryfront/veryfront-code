/** Redis caching for cross-pod SSR module sharing */
import { rendererLogger as logger } from "../../../../utils/index.js";
import { buildRedisSSRModuleKey } from "../../../../cache/index.js";
import { getSSRModuleRedisTTL } from "../constants.js";
import { CacheBackends, createDistributedCacheAccessor } from "../../../../cache/backend.js";
/** Lazy-loaded distributed cache backend for cross-pod sharing */
const getDistributedCache = createDistributedCacheAccessor(() => CacheBackends.ssrModule(), "SSR-MODULE-LOADER");
/**
 * @deprecated Legacy key builder. CacheBackend handles prefixing internally.
 * Used only for backward compatibility if needed.
 */
export function redisKey(key) {
    return buildRedisSSRModuleKey(key);
}
/** Initialize distributed caching for SSR modules */
export async function initializeSSRDistributedCache() {
    const backend = await getDistributedCache();
    return backend !== null;
}
/** Check if distributed caching is enabled for SSR modules */
export function isSSRDistributedCacheEnabled() {
    // We can't synchronously check if backend is initialized without accessing the promise
    // But we can check if we *should* be enabled based on env via CacheBackend utils
    // For now, this returns true because it's used as a guard for get/set calls
    // which themselves are async and handle missing backends gracefully.
    return true;
}
/** @deprecated Use initializeSSRDistributedCache instead */
export const initializeSSRRedisCache = initializeSSRDistributedCache;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export const isSSRRedisCacheEnabled = isSSRDistributedCacheEnabled;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export function getRedisEnabled() {
    return isSSRDistributedCacheEnabled();
}
/**
 * @deprecated Direct Redis client access is deprecated. Use CacheBackend abstraction.
 * Returns null to force use of CacheBackend path in updated consumers.
 */
export function getRedisClientInstance() {
    return null;
}
export async function getFromRedis(cacheKey) {
    const backend = await getDistributedCache();
    if (!backend)
        return null;
    try {
        return await backend.get(cacheKey);
    }
    catch (error) {
        logger.debug("[SSR-MODULE-LOADER] Distributed cache get failed", { key: cacheKey, error });
        return null;
    }
}
/** Store transformed code in Redis with environment-aware TTL */
export async function setInRedis(cacheKey, code, options) {
    const backend = await getDistributedCache();
    if (!backend)
        return;
    const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);
    try {
        await backend.set(cacheKey, code, ttl);
    }
    catch (error) {
        logger.debug("[SSR-MODULE-LOADER] Distributed cache set failed", { key: cacheKey, error });
    }
}
