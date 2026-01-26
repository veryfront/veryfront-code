export interface CacheEntry<T> {
    value: T;
    timestamp: number;
    size: number;
}
export interface FileCacheOptions {
    enabled?: boolean;
    ttl?: number;
    maxSize?: number;
    maxMemory?: number;
}
export interface CacheStats {
    size: number;
    memoryUsed: number;
    hits: number;
    misses: number;
    hitRate: number;
}
//# sourceMappingURL=types.d.ts.map