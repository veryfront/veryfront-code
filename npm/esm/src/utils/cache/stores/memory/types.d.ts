export interface CacheAdapter {
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void;
    delete(key: string): void;
    invalidateTag(tag: string): number;
    clear(): void;
}
export interface LRUCacheOptions {
    maxEntries?: number;
    maxSizeBytes?: number;
    ttlMs?: number;
    onEvict?: (key: string, value: unknown) => void;
    estimateSizeOf?: (value: unknown) => number;
}
export interface LRUEntry<T> {
    value: T;
    size: number;
    expiry?: number;
    tags?: string[];
    lastAccessed: number;
}
export interface LRUCacheStats {
    entries: number;
    sizeBytes: number;
    maxEntries: number;
    maxSizeBytes: number;
    hitRate?: number;
    tags: number;
}
//# sourceMappingURL=types.d.ts.map