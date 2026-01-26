export interface LinkObserverOptions {
    rootMargin: string;
    delay: number;
    onLinkVisible: (link: HTMLAnchorElement) => void;
}
export declare class LinkObserver {
    private options;
    private intersectionObserver;
    private mutationObserver;
    private prefetchedUrls;
    private pendingTimeouts;
    private elementTimeoutMap;
    private timeoutCounter;
    constructor(options: LinkObserverOptions, prefetchedUrls: Set<string>);
    init(): void;
    private createIntersectionObserver;
    private handleIntersection;
    private observeLinks;
    private setupMutationObserver;
    private clearTimeoutForElement;
    private clearElementTimeouts;
    private observeElement;
    private isValidLink;
    destroy(): void;
}
//# sourceMappingURL=link-observer.d.ts.map