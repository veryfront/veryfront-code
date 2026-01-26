import type { CachePayload, CacheStore } from "../types.js";
export interface APICacheStoreOptions {
    /** Key prefix for cache entries */
    keyPrefix?: string;
    /** TTL in seconds for distributed cache entries */
    ttlSeconds?: number;
    /** Max entries for local memory cache (fast reads) */
    localMaxEntries?: number;
    /** Disable local memory cache (no in-memory fallback) */
    enableLocalCache?: boolean;
}
export declare class APICacheStore implements CacheStore {
    private backend;
    private backendInitPromise;
    private readonly localCache;
    private readonly keyPrefix;
    private readonly ttlSeconds;
    private readonly enableLocalCache;
    constructor(options?: APICacheStoreOptions);
    private getBackend;
    private serialize;
    private deserialize;
    get(key: string): Promise<CachePayload | undefined>;
    set(key: string, value: CachePayload): Promise<void>;
    delete(key: string): Promise<void>;
    deleteByPrefix(prefix: string): Promise<number>;
    clear(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=api-store.d.ts.map