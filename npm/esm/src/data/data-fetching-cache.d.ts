import type { CacheEntry, DataContext } from "./types.js";
export declare class CacheManager {
    private cache;
    get(key: string): CacheEntry | null;
    set(key: string, entry: CacheEntry): void;
    delete(key: string): void;
    clear(): void;
    clearPattern(pattern: string): void;
    shouldRevalidate(entry: CacheEntry): boolean;
    createCacheKey(context: DataContext): string | null;
}
//# sourceMappingURL=data-fetching-cache.d.ts.map