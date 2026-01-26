import type { RouteData } from "./page-loader.js";
export declare class PageTransition {
    private setupViewportPrefetch;
    private pendingTransitionTimeout?;
    constructor(setupViewportPrefetch: (root: Document | HTMLElement) => void);
    destroy(): void;
    updatePage(data: RouteData, isPopState: boolean, scrollY: number): void;
    private performTransition;
    private handleScroll;
    showError(error: Error): void;
    setLoadingState(loading: boolean): void;
}
//# sourceMappingURL=page-transition.d.ts.map