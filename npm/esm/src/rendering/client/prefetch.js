import * as dntShim from "../../../_dnt.shims.js";
import { prefetchLogger } from "./browser-logger.js";
import { LinkObserver } from "./prefetch/link-observer.js";
import { NetworkUtils } from "./prefetch/network-utils.js";
import { PrefetchQueue } from "./prefetch/prefetch-queue.js";
import { ResourceHintsManager } from "./prefetch/resource-hints.js";
import { PREFETCH_DEFAULT_DELAY_MS, PREFETCH_DEFAULT_TIMEOUT_MS, PREFETCH_MAX_SIZE_BYTES, } from "../../utils/index.js";
export class PrefetchManager {
    options;
    prefetchedUrls = new Set();
    networkUtils;
    linkObserver = null;
    resourceHintsManager;
    prefetchQueue;
    constructor(options = {}) {
        this.options = {
            rootMargin: options.rootMargin ?? "50px",
            delay: options.delay ?? PREFETCH_DEFAULT_DELAY_MS,
            maxConcurrent: options.maxConcurrent ?? 2,
            allowedNetworks: options.allowedNetworks ?? ["4g", "wifi", "ethernet"],
            maxSize: options.maxSize ?? PREFETCH_MAX_SIZE_BYTES,
            timeout: options.timeout ?? PREFETCH_DEFAULT_TIMEOUT_MS,
        };
        this.networkUtils = new NetworkUtils(this.options.allowedNetworks);
        this.resourceHintsManager = new ResourceHintsManager();
        this.prefetchQueue = new PrefetchQueue({
            maxConcurrent: this.options.maxConcurrent,
            maxSize: this.options.maxSize,
            timeout: this.options.timeout,
        }, this.prefetchedUrls);
        this.prefetchQueue.setResourceCallback((response, url) => this.prefetchPageResources(response, url));
    }
    init() {
        prefetchLogger.info("Initializing prefetch manager");
        if (!this.networkUtils.shouldPrefetch()) {
            prefetchLogger.info("Prefetching disabled due to network conditions");
            return;
        }
        this.linkObserver = new LinkObserver({
            rootMargin: this.options.rootMargin,
            delay: this.options.delay,
            onLinkVisible: (link) => this.prefetchQueue.prefetchLink(link),
        }, this.prefetchedUrls);
        this.linkObserver.init();
        this.networkUtils.onNetworkChange(() => {
            if (!this.networkUtils.shouldPrefetch())
                this.prefetchQueue.stopAll();
        });
    }
    async prefetchPageResources(response, _pageUrl) {
        const html = await response.text();
        const hints = this.resourceHintsManager.extractResourceHints(html, this.prefetchedUrls);
        this.resourceHintsManager.applyResourceHints(hints);
    }
    applyResourceHints(hints) {
        this.resourceHintsManager.applyResourceHints(hints);
    }
    async prefetch(url) {
        await this.prefetchQueue.prefetch(url);
    }
    static generateResourceHints(route, assets) {
        return ResourceHintsManager.generateResourceHints(route, assets);
    }
    destroy() {
        this.linkObserver?.destroy();
        this.prefetchQueue.stopAll();
        this.prefetchedUrls.clear();
    }
}
export function initPrefetch(options) {
    const prefetchManager = new PrefetchManager(options);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => prefetchManager.init());
    }
    else {
        prefetchManager.init();
    }
    dntShim.dntGlobalThis.veryFrontPrefetch = prefetchManager;
    return prefetchManager;
}
function resolveAutoInitOptions() {
    const setting = dntShim.dntGlobalThis.__VERYFRONT_PREFETCH__;
    if (!setting)
        return null;
    if (setting === true)
        return {};
    if (typeof setting === "object")
        return setting;
    return null;
}
function shouldAutoInitPrefetch(options) {
    if (!options)
        return false;
    if (typeof dntShim.dntGlobalThis === "undefined" || typeof document === "undefined")
        return false;
    const win = dntShim.dntGlobalThis;
    const doc = document;
    if (win.__veryfrontSSRStub || doc.__veryfrontSSRStub)
        return false;
    if (typeof IntersectionObserver === "undefined")
        return false;
    if (typeof MutationObserver === "undefined")
        return false;
    return true;
}
const autoInitOptions = resolveAutoInitOptions();
if (shouldAutoInitPrefetch(autoInitOptions))
    initPrefetch(autoInitOptions);
