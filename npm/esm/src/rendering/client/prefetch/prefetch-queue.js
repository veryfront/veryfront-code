import * as dntShim from "../../../../_dnt.shims.js";
import { prefetchLogger } from "../browser-logger.js";
import { PREFETCH_QUEUE_MAX_SIZE_BYTES } from "../../../utils/constants/index.js";
const DEFAULT_OPTIONS = {
    maxConcurrent: 4,
    maxSize: PREFETCH_QUEUE_MAX_SIZE_BYTES,
    timeout: 5_000,
};
function isAbortError(error) {
    return (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError");
}
export class PrefetchQueue {
    options;
    controllers = new Map();
    prefetchedUrls;
    concurrent = 0;
    stopped = false;
    onResourcesFetched;
    constructor(options = {}, prefetchedUrls) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.prefetchedUrls = prefetchedUrls ?? new Set();
    }
    setResourceCallback(callback) {
        this.onResourcesFetched = callback;
    }
    enqueue(url) {
        void this.prefetch(url);
    }
    has(url) {
        return this.prefetchedUrls.has(url) || this.controllers.has(url);
    }
    get size() {
        return this.controllers.size;
    }
    clear() {
        this.stopAll();
        this.prefetchedUrls.clear();
    }
    start() {
        this.stopped = false;
    }
    stop() {
        this.stopped = true;
        this.stopAll();
    }
    getQueueSize() {
        return this.controllers.size;
    }
    getConcurrentCount() {
        return this.concurrent;
    }
    async prefetchLink(link) {
        if (this.stopped)
            return;
        const url = link.href;
        if (!url || this.controllers.has(url) || this.prefetchedUrls.has(url))
            return;
        if (this.concurrent >= this.options.maxConcurrent) {
            prefetchLogger.debug?.(`Prefetch queue full, skipping ${url}`);
            return;
        }
        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        }
        catch {
            prefetchLogger.debug?.(`Invalid prefetch URL ${url}`);
            return;
        }
        const controller = new AbortController();
        this.controllers.set(url, controller);
        this.concurrent += 1;
        const timeoutId = this.options.timeout > 0
            ? dntShim.setTimeout(() => controller.abort(), this.options.timeout)
            : undefined;
        try {
            const response = await dntShim.fetch(parsedUrl.toString(), {
                method: "GET",
                signal: controller.signal,
                headers: { "X-Veryfront-Prefetch": "1" },
            });
            if (!response.ok)
                return;
            if (this.isResponseTooLarge(response)) {
                prefetchLogger.debug?.(`Prefetch too large, skipping ${url}`);
                return;
            }
            this.prefetchedUrls.add(url);
            if (!this.onResourcesFetched)
                return;
            try {
                await this.onResourcesFetched(response, url);
            }
            catch (callbackError) {
                prefetchLogger.error?.(`Prefetch callback failed for ${url}`, callbackError);
            }
        }
        catch (error) {
            if (!isAbortError(error)) {
                prefetchLogger.error?.(`Failed to prefetch ${url}`, error);
            }
        }
        finally {
            if (timeoutId !== undefined)
                clearTimeout(timeoutId);
            this.controllers.delete(url);
            this.concurrent = Math.max(0, this.concurrent - 1);
        }
    }
    async prefetch(url) {
        const link = typeof document !== "undefined"
            ? document.createElement("a")
            : { href: url };
        link.href = url;
        await this.prefetchLink(link);
    }
    stopAll() {
        for (const controller of this.controllers.values()) {
            controller.abort();
        }
        this.controllers.clear();
        this.concurrent = 0;
    }
    isResponseTooLarge(response) {
        const rawLength = response.headers.get("content-length");
        if (rawLength === null)
            return false;
        const size = Number.parseInt(rawLength, 10);
        if (!Number.isFinite(size))
            return false;
        return size > this.options.maxSize;
    }
}
export const prefetchQueue = new PrefetchQueue();
export default prefetchQueue;
