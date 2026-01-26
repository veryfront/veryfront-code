import type { CacheAdapter, LRUCacheOptions, LRUCacheStats } from "./types.js";
export declare class LRUCacheAdapter implements CacheAdapter {
    private readonly store;
    private readonly tagIndex;
    private readonly listManager;
    private readonly evictionManager;
    private readonly entryManager;
    private currentSize;
    private readonly maxEntries;
    private readonly maxSizeBytes;
    private readonly defaultTtlMs?;
    private readonly onEvict?;
    constructor(options?: LRUCacheOptions);
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T, ttlMs?: number, tags?: string[]): void;
    delete(key: string): void;
    invalidateTag(tag: string): number;
    clear(): void;
    getStats(): LRUCacheStats;
    cleanupExpired(): number;
    keys(): IterableIterator<string>;
    has(key: string): boolean;
}
//# sourceMappingURL=lru-cache-adapter.d.ts.map