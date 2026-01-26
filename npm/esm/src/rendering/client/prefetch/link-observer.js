import * as dntShim from "../../../../_dnt.shims.js";
function isAnchorElement(element) {
    return typeof HTMLAnchorElement !== "undefined"
        ? element instanceof HTMLAnchorElement
        : element.tagName === "A";
}
export class LinkObserver {
    options;
    intersectionObserver = null;
    mutationObserver = null;
    prefetchedUrls;
    pendingTimeouts = new Map();
    elementTimeoutMap = new WeakMap();
    timeoutCounter = 0;
    constructor(options, prefetchedUrls) {
        this.options = options;
        this.prefetchedUrls = prefetchedUrls;
    }
    init() {
        this.createIntersectionObserver();
        this.observeLinks();
        this.setupMutationObserver();
    }
    createIntersectionObserver() {
        this.intersectionObserver = new IntersectionObserver((entries) => this.handleIntersection(entries), { rootMargin: this.options.rootMargin });
    }
    handleIntersection(entries) {
        for (const entry of entries) {
            if (!entry.isIntersecting)
                continue;
            if (!isAnchorElement(entry.target))
                continue;
            const link = entry.target;
            // Reset counter if it gets too high (prevents unbounded growth in long-running sessions)
            if (this.timeoutCounter > 1_000_000)
                this.timeoutCounter = 0;
            const timeoutKey = this.timeoutCounter++;
            const timeoutId = dntShim.setTimeout(() => {
                this.pendingTimeouts.delete(timeoutKey);
                this.elementTimeoutMap.delete(link);
                this.options.onLinkVisible(link);
            }, this.options.delay);
            this.pendingTimeouts.set(timeoutKey, timeoutId);
            this.elementTimeoutMap.set(link, timeoutKey);
        }
    }
    observeLinks() {
        const links = document.querySelectorAll('a[href^="/"], a[href^="./"]');
        for (const link of links) {
            if (!isAnchorElement(link))
                continue;
            if (!this.isValidLink(link))
                continue;
            this.intersectionObserver?.observe(link);
        }
    }
    setupMutationObserver() {
        this.mutationObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type !== "childList")
                    continue;
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE)
                        continue;
                    this.observeElement(node);
                }
                for (const node of mutation.removedNodes) {
                    if (node.nodeType !== Node.ELEMENT_NODE)
                        continue;
                    this.clearElementTimeouts(node);
                }
            }
        });
        this.mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
    clearTimeoutForElement(element) {
        const timeoutKey = this.elementTimeoutMap.get(element);
        if (timeoutKey === undefined)
            return;
        const timeoutId = this.pendingTimeouts.get(timeoutKey);
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            this.pendingTimeouts.delete(timeoutKey);
        }
        this.elementTimeoutMap.delete(element);
    }
    clearElementTimeouts(element) {
        if (isAnchorElement(element))
            this.clearTimeoutForElement(element);
        for (const link of element.querySelectorAll("a")) {
            this.clearTimeoutForElement(link);
        }
    }
    observeElement(element) {
        if (isAnchorElement(element) && this.isValidLink(element)) {
            this.intersectionObserver?.observe(element);
        }
        for (const link of element.querySelectorAll('a[href^="/"], a[href^="./"]')) {
            if (!isAnchorElement(link))
                continue;
            if (!this.isValidLink(link))
                continue;
            this.intersectionObserver?.observe(link);
        }
    }
    isValidLink(link) {
        if (link.hostname !== globalThis.location.hostname)
            return false;
        if (link.hasAttribute("download"))
            return false;
        if (link.target === "_blank")
            return false;
        const url = link.href;
        if (this.prefetchedUrls.has(url))
            return false;
        if (url === globalThis.location.href)
            return false;
        if (link.hash && link.pathname === globalThis.location.pathname)
            return false;
        if (link.dataset.noPrefetch)
            return false;
        return true;
    }
    destroy() {
        for (const timeoutId of this.pendingTimeouts.values()) {
            clearTimeout(timeoutId);
        }
        this.pendingTimeouts.clear();
        this.timeoutCounter = 0;
        this.intersectionObserver?.disconnect();
        this.intersectionObserver = null;
        this.mutationObserver?.disconnect();
        this.mutationObserver = null;
    }
}
