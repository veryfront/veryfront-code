import * as dntShim from "../../../../_dnt.shims.js";
export interface PrefetchQueueOptions {
    maxConcurrent: number;
    maxSize: number;
    timeout: number;
}
type ResourceCallback = (response: dntShim.Response, url: string) => void | Promise<void>;
export declare class PrefetchQueue {
    private options;
    private controllers;
    private prefetchedUrls;
    private concurrent;
    private stopped;
    private onResourcesFetched?;
    constructor(options?: Partial<PrefetchQueueOptions>, prefetchedUrls?: Set<string>);
    setResourceCallback(callback: ResourceCallback): void;
    enqueue(url: string): void;
    has(url: string): boolean;
    get size(): number;
    clear(): void;
    start(): void;
    stop(): void;
    getQueueSize(): number;
    getConcurrentCount(): number;
    prefetchLink(link: HTMLAnchorElement): Promise<void>;
    prefetch(url: string): Promise<void>;
    stopAll(): void;
    private isResponseTooLarge;
}
export declare const prefetchQueue: PrefetchQueue;
export default prefetchQueue;
//# sourceMappingURL=prefetch-queue.d.ts.map