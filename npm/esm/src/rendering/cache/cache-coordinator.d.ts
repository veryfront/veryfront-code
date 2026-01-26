import type { RenderResult } from "../orchestrator/types.js";
import type { CacheStore } from "./types.js";
import { type MemoryCacheStoreOptions } from "./stores/index.js";
export interface CacheCoordinatorOptions {
    store?: CacheStore;
    memory?: MemoryCacheStoreOptions;
    ttlMs?: number;
}
export interface CacheLookupResult {
    cachedResult?: RenderResult;
    depAwareSlug: string;
    moduleCacheKey: string;
    cachedModule?: RenderResult["pageModule"];
}
export declare class CacheCoordinator {
    private store;
    private ttlMs?;
    constructor(options?: CacheCoordinatorOptions);
    checkCache(slug: string): Promise<CacheLookupResult>;
    persistResult(result: RenderResult, slug: string): Promise<void>;
    clearAll(): Promise<void>;
    clearSlug(slug: string): Promise<void>;
    destroy(): Promise<void>;
    private isExpired;
}
//# sourceMappingURL=cache-coordinator.d.ts.map