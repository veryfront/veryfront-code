import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { DataContext, DataResult, PageWithData, StaticPathsResult } from "./types.js";
export declare class DataFetcher {
    private cacheManager;
    private serverFetcher;
    private staticFetcher;
    private pathsFetcher;
    constructor(adapter?: RuntimeAdapter);
    fetchData(pageModule: PageWithData, context: DataContext, mode?: "development" | "production"): Promise<DataResult>;
    getStaticPaths(pageModule: PageWithData): Promise<StaticPathsResult | null>;
    clearCache(pattern?: string): void;
}
//# sourceMappingURL=data-fetcher.d.ts.map