import type { RouteData, SpaPageData } from "../../routing/index.js";
export type SpaNavigationHandler = (data: SpaPageData) => Promise<void>;
declare global {
    interface Window {
        __VERYFRONT_ROUTER_OPTS__?: Partial<RouterOptions>;
        __VERYFRONT_SPA_MODE__?: boolean;
        veryFrontRouter?: VeryfrontRouter;
    }
    var __VERYFRONT_ROUTER_OPTS__: Partial<RouterOptions> | undefined;
    var __VERYFRONT_SPA_MODE__: boolean | undefined;
}
export type { RouteData, SpaPageData };
export interface RouterOptions {
    baseUrl?: string;
    spaMode?: boolean;
    onNavigate?: (url: string) => void;
    onStart?: (url: string) => void;
    onComplete?: (url: string) => void;
    onError?: (error: Error) => void;
    prefetchDelay?: number;
    prefetch?: {
        hover?: boolean;
        viewport?: boolean;
    };
}
export declare class VeryfrontRouter {
    private baseUrl;
    private currentPath;
    private root;
    private options;
    private spaMode;
    private spaNavigationHandler;
    private pageLoader;
    private navigationHandlers;
    private pageTransition;
    private viewportPrefetch;
    private handleClick;
    private handlePopState;
    private handleMouseOver;
    constructor(options?: RouterOptions);
    registerNavigationHandler(handler: SpaNavigationHandler): void;
    private loadGlobalOptions;
    init(): void;
    private cacheCurrentPage;
    navigate(url: string, pushState?: boolean): Promise<void>;
    private loadSpaPage;
    private handleScrollAfterNavigation;
    private loadPage;
    prefetch(path: string): Promise<void>;
    private updatePage;
    destroy(): void;
}
//# sourceMappingURL=router.d.ts.map