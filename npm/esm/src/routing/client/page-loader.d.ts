export type { ComponentMap, FrontmatterData, LayoutInfo, PageData, RouteData, SpaPageData, } from "./types.js";
import type { RouteData, SpaPageData } from "./types.js";
export declare class PageLoader {
    private cache;
    private spaCache;
    private pendingRequests;
    private pendingSpaRequests;
    private evictIfFull;
    getCached(path: string): RouteData | undefined;
    isCached(path: string): boolean;
    setCache(path: string, data: RouteData): void;
    clearCache(): void;
    getSpaCached(path: string): SpaPageData | undefined;
    isSpaDataCached(path: string): boolean;
    setSpaCache(path: string, data: SpaPageData): void;
    fetchPageData(path: string): Promise<RouteData>;
    private tryFetchJSON;
    private fetchAndParseHTML;
    loadPage(path: string): Promise<RouteData>;
    prefetch(path: string): Promise<void>;
    fetchSpaPageData(path: string): Promise<SpaPageData>;
    loadSpaPageData(path: string): Promise<SpaPageData>;
    prefetchSpaPageData(path: string): Promise<void>;
    private createPendingRequest;
}
//# sourceMappingURL=page-loader.d.ts.map