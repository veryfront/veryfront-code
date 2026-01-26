import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { CacheManager } from "./data-fetching-cache.js";
import type { DataContext, DataResult, PageWithData } from "./types.js";
export declare class StaticDataFetcher {
    private cacheManager;
    private adapter?;
    private pendingRevalidations;
    constructor(cacheManager: CacheManager, adapter?: RuntimeAdapter | undefined);
    fetch(pageModule: PageWithData, context: DataContext): Promise<DataResult>;
    private fetchFreshNoCache;
    private fetchFresh;
    private revalidateInBackground;
    private logError;
}
//# sourceMappingURL=static-data-fetcher.d.ts.map