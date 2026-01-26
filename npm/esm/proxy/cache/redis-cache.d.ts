/**
 * Redis Token Cache
 *
 * Uses the standard `redis` package for cross-runtime compatibility.
 * Works in Deno, Node.js, and Bun.
 */
import type { CacheStats, RedisCacheOptions, TokenCache, TokenCacheEntry } from "./types.js";
export declare class RedisCache implements TokenCache {
    private client;
    private prefix;
    private url;
    private connectTimeout;
    private hits;
    private misses;
    private connected;
    constructor(options: RedisCacheOptions);
    private key;
    get(key: string): Promise<TokenCacheEntry | null>;
    set(key: string, entry: TokenCacheEntry): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
    has(key: string): Promise<boolean>;
    stats(): Promise<CacheStats>;
    close(): Promise<void>;
    private ensureConnected;
}
//# sourceMappingURL=redis-cache.d.ts.map