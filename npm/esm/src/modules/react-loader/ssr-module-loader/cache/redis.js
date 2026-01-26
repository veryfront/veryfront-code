/** Redis caching for cross-pod SSR module sharing */
import { rendererLogger as logger } from "../../../../utils/index.js";
import { getRedisClient, isRedisConfigured, } from "../../../../utils/redis-client.js";
import { buildRedisSSRModuleKey } from "../../../../cache/index.js";
import { getSSRModuleRedisTTL } from "../constants.js";
let redisEnabled = false;
let redisClient = null;
let redisInitialized = false;
let redisInitPromise = null;
export function redisKey(key) {
    return buildRedisSSRModuleKey(key);
}
/** Initialize distributed caching for SSR modules */
export async function initializeSSRDistributedCache() {
    if (redisInitialized)
        return redisEnabled;
    if (redisInitPromise) {
        await redisInitPromise;
        return redisEnabled;
    }
    redisInitPromise = (async () => {
        if (!isRedisConfigured()) {
            logger.debug("[SSR-MODULE-LOADER] Redis not configured, using memory cache");
            redisInitialized = true;
            return;
        }
        try {
            redisClient = await getRedisClient();
            redisEnabled = true;
            logger.debug("[SSR-MODULE-LOADER] Redis cache enabled");
        }
        catch (error) {
            logger.warn("[SSR-MODULE-LOADER] Redis unavailable, falling back to memory cache", { error });
            redisEnabled = false;
        }
        finally {
            redisInitialized = true;
        }
    })();
    await redisInitPromise;
    redisInitPromise = null;
    return redisEnabled;
}
export function isSSRDistributedCacheEnabled() {
    return redisEnabled && redisClient !== null;
}
/** @deprecated Use initializeSSRDistributedCache instead */
export const initializeSSRRedisCache = initializeSSRDistributedCache;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export const isSSRRedisCacheEnabled = isSSRDistributedCacheEnabled;
export function getRedisEnabled() {
    return redisEnabled;
}
export function getRedisClientInstance() {
    return redisClient;
}
export async function getFromRedis(cacheKey) {
    if (!redisEnabled || !redisClient)
        return null;
    try {
        return await redisClient.get(redisKey(cacheKey));
    }
    catch (error) {
        logger.debug("[SSR-MODULE-LOADER] Redis get failed", { key: cacheKey, error });
        return null;
    }
}
/** Store transformed code in Redis with environment-aware TTL */
export async function setInRedis(cacheKey, code, options) {
    if (!redisEnabled || !redisClient)
        return;
    const ttl = options?.ttlSeconds ?? getSSRModuleRedisTTL(options?.isProduction ?? true);
    try {
        await redisClient.set(redisKey(cacheKey), code, { EX: ttl });
    }
    catch (error) {
        logger.debug("[SSR-MODULE-LOADER] Redis set failed", { key: cacheKey, error });
    }
}
