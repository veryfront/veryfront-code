/** Redis caching for cross-pod SSR module sharing */
import { type RedisClient } from "../../../../utils/redis-client.js";
export declare function redisKey(key: string): string;
/** Initialize distributed caching for SSR modules */
export declare function initializeSSRDistributedCache(): Promise<boolean>;
export declare function isSSRDistributedCacheEnabled(): boolean;
/** @deprecated Use initializeSSRDistributedCache instead */
export declare const initializeSSRRedisCache: typeof initializeSSRDistributedCache;
/** @deprecated Use isSSRDistributedCacheEnabled instead */
export declare const isSSRRedisCacheEnabled: typeof isSSRDistributedCacheEnabled;
export declare function getRedisEnabled(): boolean;
export declare function getRedisClientInstance(): RedisClient | null;
export declare function getFromRedis(cacheKey: string): Promise<string | null>;
/** Store transformed code in Redis with environment-aware TTL */
export declare function setInRedis(cacheKey: string, code: string, options?: {
    isProduction?: boolean;
    ttlSeconds?: number;
}): Promise<void>;
//# sourceMappingURL=redis.d.ts.map