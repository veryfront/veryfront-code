/**
 * Token Cache Interface
 *
 * Abstraction for storing OAuth tokens with TTL support.
 * Implementations: MemoryCache, RedisCache
 */
export interface TokenCacheEntry {
    token: string;
    expiresAt: number;
    scope: "preview" | "production";
    projectSlug?: string;
}
export interface TokenCache {
    /**
     * Get a cached token entry.
     */
    get(key: string): Promise<TokenCacheEntry | null>;
    /**
     * Set a token entry with automatic TTL based on expiresAt.
     */
    set(key: string, entry: TokenCacheEntry): Promise<void>;
    /**
     * Delete a specific token entry.
     */
    delete(key: string): Promise<void>;
    /**
     * Clear all cached tokens.
     */
    clear(): Promise<void>;
    /**
     * Check if a key exists in cache.
     */
    has(key: string): Promise<boolean>;
    /**
     * Get cache statistics.
     */
    stats(): Promise<CacheStats>;
    /**
     * Close any connections (for Redis).
     */
    close(): Promise<void>;
}
export interface CacheStats {
    hits: number;
    misses: number;
    size: number;
    type: "memory" | "redis";
}
export interface MemoryCacheOptions {
    maxSize?: number;
    cleanupInterval?: number;
}
export interface RedisCacheOptions {
    url: string;
    prefix?: string;
    connectTimeout?: number;
}
export type CacheOptions = {
    type: "memory";
    options?: MemoryCacheOptions;
} | {
    type: "redis";
    options: RedisCacheOptions;
};
//# sourceMappingURL=types.d.ts.map