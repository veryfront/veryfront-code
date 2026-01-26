/** Redis caching for cross-pod SSR module sharing */
import { type RedisClient } from "../../../../utils/redis-client.js";
/**
 * @deprecated Legacy key builder. CacheBackend handles prefixing internally.
 * Used only for backward compatibility if needed.
 */
export declare function redisKey(key: string): string;
/** Initialize distributed caching for SSR modules */
export declare function initializeSSRDistributedCache(): Promise<boolean>;
/** Check if distributed caching is enabled for SSR modules */
export declare function isSSRDistributedCacheEnabled(): boolean;
/** @deprecated Use initializeSSRDistributedCache instead */
export declare const initializeSSRRedisCache: typeof initializeSSRDistributedCache;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export declare const isSSRRedisCacheEnabled: typeof isSSRDistributedCacheEnabled;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export declare function getRedisEnabled(): boolean;
/**
 * @deprecated Direct Redis client access is deprecated. Use CacheBackend abstraction.
 * Returns null to force use of CacheBackend path in updated consumers.
 */
export declare function getRedisClientInstance(): RedisClient | null;
export declare function getFromRedis(cacheKey: string): Promise<string | null>;
/** Store transformed code in Redis with environment-aware TTL */
export declare function setInRedis(cacheKey: string, code: string, options?: {
    isProduction?: boolean;
    ttlSeconds?: number;
}): Promise<void>;
//# sourceMappingURL=redis.d.ts.map