import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { DEFAULT_PREFETCH_DELAY_MS } from "../../config/index.js";
import { findAnchorElement, isInternalLink } from "./dom-utils.js";
const MAX_SCROLL_POSITIONS = 100;
export class NavigationHandlers {
    prefetchQueue = new Set();
    pendingTimeouts = new Map();
    scrollPositions = new Map();
    isPopStateNav = false;
    prefetchDelay;
    prefetchOptions;
    constructor(prefetchDelay = DEFAULT_PREFETCH_DELAY_MS, prefetchOptions = {}) {
        this.prefetchDelay = prefetchDelay;
        this.prefetchOptions = prefetchOptions;
    }
    createClickHandler(callbacks) {
        return (event) => {
            if (!(event.target instanceof HTMLElement))
                return;
            const anchor = findAnchorElement(event.target);
            if (!anchor || !isInternalLink(anchor))
                return;
            const href = anchor.getAttribute("href");
            if (!href)
                return;
            event.preventDefault();
            callbacks.onNavigate(href);
        };
    }
    createPopStateHandler(callbacks) {
        return (_event) => {
            this.isPopStateNav = true;
            callbacks.onNavigate(globalThis.location.pathname);
        };
    }
    createMouseOverHandler(callbacks) {
        return (event) => {
            if (!(event.target instanceof HTMLElement))
                return;
            const target = event.target;
            if (target.tagName !== "A")
                return;
            const href = target.getAttribute("href");
            if (!href || href.startsWith("http") || href.startsWith("#"))
                return;
            if (!this.shouldPrefetchOnHover(target))
                return;
            if (this.prefetchQueue.has(href))
                return;
            this.prefetchQueue.add(href);
            const timeoutId = dntShim.setTimeout(() => {
                callbacks.onPrefetch(href);
                this.prefetchQueue.delete(href);
                this.pendingTimeouts.delete(href);
            }, this.prefetchDelay);
            this.pendingTimeouts.set(href, timeoutId);
        };
    }
    shouldPrefetchOnHover(target) {
        const prefetchAttribute = target.getAttribute("data-prefetch");
        if (prefetchAttribute === "false")
            return false;
        if (prefetchAttribute === "true")
            return true;
        return Boolean(this.prefetchOptions.hover);
    }
    saveScrollPosition(path) {
        try {
            if (this.scrollPositions.size >= MAX_SCROLL_POSITIONS) {
                const oldest = this.scrollPositions.keys().next().value;
                if (oldest)
                    this.scrollPositions.delete(oldest);
            }
            const scrollY = globalThis.scrollY;
            if (typeof scrollY !== "number") {
                logger.debug("[Veryfront] No valid scrollY value available");
                this.scrollPositions.set(path, 0);
                return;
            }
            this.scrollPositions.set(path, scrollY);
        }
        catch (error) {
            logger.warn("[Veryfront] failed to record scroll position", error);
        }
    }
    getScrollPosition(path) {
        const position = this.scrollPositions.get(path);
        if (position === undefined) {
            logger.debug(`[Veryfront] No scroll position stored for ${path}`);
            return 0;
        }
        return position;
    }
    isPopState() {
        return this.isPopStateNav;
    }
    clearPopStateFlag() {
        this.isPopStateNav = false;
    }
    clear() {
        for (const timeoutId of this.pendingTimeouts.values())
            clearTimeout(timeoutId);
        this.pendingTimeouts.clear();
        this.prefetchQueue.clear();
        this.scrollPositions.clear();
        this.isPopStateNav = false;
    }
}
