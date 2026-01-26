import type { RenderResult } from "../orchestrator/types.js";
import type { CacheStore } from "../cache/types.js";
import { type MemoryCacheStoreOptions } from "../cache/stores/index.js";
import type { RenderContext } from "../context/render-context.js";
export interface ContextAwareCacheOptions {
    store?: CacheStore;
    memory?: MemoryCacheStoreOptions;
    ttlMs?: number;
}
export interface ContextAwareCacheLookupResult {
    cachedResult?: RenderResult;
    cacheKey: string;
    hit: boolean;
}
export declare class ContextAwareCacheCoordinator {
    private store;
    private ttlMs?;
    constructor(options?: ContextAwareCacheOptions);
    checkCache(slug: string, ctx: RenderContext, colorScheme?: "light" | "dark"): Promise<ContextAwareCacheLookupResult>;
    persistResult(result: RenderResult, slug: string, ctx: RenderContext, colorScheme?: "light" | "dark"): Promise<void>;
    clearForContext(ctx: RenderContext): Promise<void>;
    clearForProject(projectId: string): Promise<void>;
    clearSlug(slug: string, ctx: RenderContext): Promise<void>;
    clearAll(): Promise<void>;
    destroy(): Promise<void>;
    getStats(): {
        size: number;
    };
    private getCacheKey;
    private isExpired;
    private cloneResult;
}
//# sourceMappingURL=context-aware-cache.d.ts.map