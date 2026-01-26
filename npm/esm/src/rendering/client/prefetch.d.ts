import { type ResourceHint } from "./prefetch/resource-hints.js";
export type { ResourceHint };
declare global {
    interface Window {
        veryFrontPrefetch?: PrefetchManager;
        __VERYFRONT_PREFETCH__?: PrefetchAutoInitSetting;
    }
}
export interface PrefetchOptions {
    rootMargin?: string;
    delay?: number;
    maxConcurrent?: number;
    allowedNetworks?: string[];
    maxSize?: number;
    timeout?: number;
}
type PrefetchAutoInitSetting = boolean | PrefetchOptions;
export declare class PrefetchManager {
    private options;
    private prefetchedUrls;
    private networkUtils;
    private linkObserver;
    private resourceHintsManager;
    private prefetchQueue;
    constructor(options?: PrefetchOptions);
    init(): void;
    private prefetchPageResources;
    applyResourceHints(hints: ResourceHint[]): void;
    prefetch(url: string): Promise<void>;
    static generateResourceHints(route: string, assets: string[]): string;
    destroy(): void;
}
export declare function initPrefetch(options?: PrefetchOptions): PrefetchManager;
//# sourceMappingURL=prefetch.d.ts.map