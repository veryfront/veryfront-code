import type { CachePayload, CacheStore } from "../types.js";
export interface MemoryCacheStoreOptions {
    maxEntries?: number;
    ttlMs?: number;
}
export declare class MemoryCacheStore implements CacheStore {
    private cache;
    constructor(options?: MemoryCacheStoreOptions);
    get(key: string): Promise<CachePayload | undefined>;
    set(key: string, value: CachePayload): Promise<void>;
    delete(key: string): Promise<void>;
    /**
     * Delete all entries with keys starting with the given prefix.
     * Used for per-project cache invalidation in multi-tenant deployments.
     */
    deleteByPrefix(prefix: string): Promise<number>;
    clear(): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=memory-store.d.ts.map