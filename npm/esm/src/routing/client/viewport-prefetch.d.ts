export declare class ViewportPrefetch {
    private observer;
    private prefetchCallback;
    private prefetchOptions;
    constructor(prefetchCallback: (path: string) => void, prefetchOptions?: {
        hover?: boolean;
        viewport?: boolean;
    });
    setup(root: Document | HTMLElement): void;
    private createObserver;
    private observeLinks;
    private shouldObserveAnchor;
    disconnect(): void;
}
//# sourceMappingURL=viewport-prefetch.d.ts.map