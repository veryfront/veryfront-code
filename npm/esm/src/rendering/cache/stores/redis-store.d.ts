import type { CachePayload, CacheStore } from "../types.js";
export interface RedisCacheStoreOptions {
    url?: string;
    keyPrefix?: string;
    enableFallback?: boolean;
    /** TTL in seconds for cache entries (default: 3600 = 1 hour) */
    ttlSeconds?: number;
}
export declare class RedisCacheStore implements CacheStore {
    private client;
    private readonly url?;
    private readonly keyPrefix;
    private readonly enableFallback;
    private readonly ttlSeconds;
    private fallbackStore;
    private redisUnavailable;
    private errorLogged;
    constructor(options?: RedisCacheStoreOptions);
    private getFallbackStore;
    private ensureClient;
    private storageKey;
    get(key: string): Promise<CachePayload | undefined>;
    set(key: string, value: CachePayload): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByPrefix(prefix: string): Promise<number>;
    clear(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=redis-store.d.ts.map