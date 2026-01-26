import * as dntShim from "../../../_dnt.shims.js";
import { rendererLogger as logger } from "../../utils/index.js";
import { PAGE_TRANSITION_DELAY_MS } from "../../config/index.js";
import { applyHeadDirectives, executeScripts, manageFocus, updateMetaTags } from "./dom-utils.js";
import { validateTrustedHtml } from "../../security/client/html-sanitizer.js";
export class PageTransition {
    setupViewportPrefetch;
    pendingTransitionTimeout;
    constructor(setupViewportPrefetch) {
        this.setupViewportPrefetch = setupViewportPrefetch;
    }
    destroy() {
        if (this.pendingTransitionTimeout === undefined)
            return;
        clearTimeout(this.pendingTransitionTimeout);
        this.pendingTransitionTimeout = undefined;
    }
    updatePage(data, isPopState, scrollY) {
        const title = data.frontmatter?.title;
        if (title)
            document.title = title;
        updateMetaTags(data.frontmatter ?? {});
        const rootElement = document.getElementById("root");
        if (!rootElement || !data.html)
            return;
        this.performTransition(rootElement, data, isPopState, scrollY);
    }
    performTransition(rootElement, data, isPopState, scrollY) {
        if (this.pendingTransitionTimeout !== undefined) {
            clearTimeout(this.pendingTransitionTimeout);
        }
        rootElement.style.opacity = "0";
        this.pendingTransitionTimeout = dntShim.setTimeout(() => {
            this.pendingTransitionTimeout = undefined;
            // Server-rendered RSC HTML is trusted; validateTrustedHtml provides defense-in-depth
            rootElement.innerHTML = validateTrustedHtml(String(data.html ?? ""));
            rootElement.style.opacity = "1";
            executeScripts(rootElement);
            applyHeadDirectives(rootElement);
            this.setupViewportPrefetch(rootElement);
            manageFocus(rootElement);
            this.handleScroll(isPopState, scrollY);
        }, PAGE_TRANSITION_DELAY_MS);
    }
    handleScroll(isPopState, scrollY) {
        try {
            globalThis.scrollTo(0, isPopState ? scrollY : 0);
        }
        catch (error) {
            logger.warn("[Veryfront] scroll handling failed", error);
        }
    }
    showError(error) {
        const rootElement = document.getElementById("root");
        if (!rootElement)
            return;
        const errorDiv = document.createElement("div");
        errorDiv.className = "veryfront-error-page";
        const heading = document.createElement("h1");
        heading.textContent = "Oops! Something went wrong";
        const message = document.createElement("p");
        message.textContent = error.message;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = "Reload Page";
        button.onclick = () => globalThis.location.reload();
        errorDiv.append(heading, message, button);
        rootElement.innerHTML = "";
        rootElement.appendChild(errorDiv);
    }
    setLoadingState(loading) {
        const indicator = document.getElementById("veryfront-loading");
        if (indicator)
            indicator.style.display = loading ? "block" : "none";
        document.body.classList.toggle("veryfront-loading", loading);
    }
}
