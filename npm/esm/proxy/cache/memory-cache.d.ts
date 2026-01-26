import type { CacheStats, MemoryCacheOptions, TokenCache, TokenCacheEntry } from "./types.js";
export declare class MemoryCache implements TokenCache {
    private cache;
    private hits;
    private misses;
    private maxSize;
    private cleanupTimer;
    constructor(options?: MemoryCacheOptions);
    get(key: string): Promise<TokenCacheEntry | null>;
    set(key: string, entry: TokenCacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    has(key: string): Promise<boolean>;
    stats(): Promise<CacheStats>;
    close(): Promise<void>;
    private cleanup;
}
//# sourceMappingURL=memory-cache.d.ts.map