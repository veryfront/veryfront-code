import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
export class ViewportPrefetch {
    observer = null;
    prefetchCallback;
    prefetchOptions;
    constructor(prefetchCallback, prefetchOptions = {}) {
        this.prefetchCallback = prefetchCallback;
        this.prefetchOptions = prefetchOptions;
    }
    setup(root) {
        try {
            if (!("IntersectionObserver" in dntShim.dntGlobalThis))
                return;
            this.observer?.disconnect();
            this.createObserver();
            this.observeLinks(root);
        }
        catch (error) {
            logger.debug("[Veryfront] setupViewportPrefetch failed", error);
        }
    }
    createObserver() {
        this.observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting)
                    continue;
                if (!(entry.target instanceof HTMLAnchorElement))
                    continue;
                const href = entry.target.getAttribute("href");
                if (href)
                    this.prefetchCallback(href);
                this.observer?.unobserve(entry.target);
            }
        }, { rootMargin: "200px" });
    }
    observeLinks(root) {
        const anchors = root.querySelectorAll('a[href]:not([target="_blank"])') ??
            document.createDocumentFragment().querySelectorAll("a");
        const isViewportEnabled = Boolean(this.prefetchOptions.viewport);
        for (const anchor of anchors) {
            if (!this.shouldObserveAnchor(anchor, isViewportEnabled))
                continue;
            this.observer?.observe(anchor);
        }
    }
    shouldObserveAnchor(anchor, isViewportEnabled) {
        const href = anchor.getAttribute("href") ?? "";
        if (!href)
            return false;
        if (href.startsWith("http") || href.startsWith("#"))
            return false;
        if (anchor.getAttribute("download"))
            return false;
        const prefetchAttribute = anchor.getAttribute("data-prefetch");
        if (prefetchAttribute === "false")
            return false;
        return prefetchAttribute === "viewport" || isViewportEnabled;
    }
    disconnect() {
        if (!this.observer)
            return;
        try {
            this.observer.disconnect();
        }
        catch (error) {
            logger.warn("[Veryfront] prefetchObserver.disconnect failed", error);
        }
        finally {
            this.observer = null;
        }
    }
}
