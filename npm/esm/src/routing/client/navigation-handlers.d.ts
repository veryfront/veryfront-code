export interface NavigationCallbacks {
    onNavigate: (url: string) => Promise<void>;
    onPrefetch: (url: string) => void;
}
export declare class NavigationHandlers {
    private prefetchQueue;
    private pendingTimeouts;
    private scrollPositions;
    private isPopStateNav;
    private prefetchDelay;
    private prefetchOptions;
    constructor(prefetchDelay?: number, prefetchOptions?: {
        hover?: boolean;
        viewport?: boolean;
    });
    createClickHandler(callbacks: NavigationCallbacks): (event: MouseEvent) => void;
    createPopStateHandler(callbacks: NavigationCallbacks): (_event: PopStateEvent) => void;
    createMouseOverHandler(callbacks: NavigationCallbacks): (event: MouseEvent) => void;
    private shouldPrefetchOnHover;
    saveScrollPosition(path: string): void;
    getScrollPosition(path: string): number;
    isPopState(): boolean;
    clearPopStateFlag(): void;
    clear(): void;
}
//# sourceMappingURL=navigation-handlers.d.ts.map