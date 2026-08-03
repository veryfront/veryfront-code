import { PAGE_TRANSITION_DELAY_MS } from "#veryfront/config";
import { retireClientHeadOwnership } from "#veryfront/html/client-head-manager.ts";
import {
  applyPreparedClientRouteHeadDescriptors,
  prepareClientRouteHeadEntries,
  updateRouteMetaTags,
  updateRouteTitle,
} from "#veryfront/html/client-route-head.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rendererLogger } from "#veryfront/utils";
import { applyHeadDirectives, manageFocus, routeRequiresDocumentNavigation } from "./dom-utils.ts";
import type { RouteData } from "./page-loader.ts";

const logger = rendererLogger.component("veryfront");

export class PageTransition {
  private pendingTransitionTimeout?: number;
  private pendingRoot?: HTMLElement;

  constructor(private setupViewportPrefetch: (root: Document | HTMLElement) => void) {}

  destroy(): void {
    this.cancelPendingTransition();
  }

  cancelPendingTransition(): void {
    if (this.pendingTransitionTimeout !== undefined) {
      clearTimeout(this.pendingTransitionTimeout);
      this.pendingTransitionTimeout = undefined;
    }
    if (this.pendingRoot) {
      this.pendingRoot.style.opacity = "1";
      this.pendingRoot = undefined;
    }
  }

  updatePage(data: RouteData, isPopState: boolean, scrollY: number): void {
    this.cancelPendingTransition();
    // A backstop: the loader classifies scripted destinations so the router
    // hands them to the document loader before reaching a soft transition.
    if (routeRequiresDocumentNavigation(data)) {
      throw new TypeError("Scripted routes require a full document navigation");
    }

    const rootElement = document.getElementById("root");
    const preparedHead = prepareClientRouteHeadEntries(data.managedHead, document);
    const retainedTitle = document.title;
    if (!rootElement || data.html === undefined) {
      retireClientHeadOwnership(document);
      applyPreparedClientRouteHeadDescriptors(preparedHead, document);
      this.updateDocumentMetadata(document, data, retainedTitle);
      return;
    }

    const trustedHtml = validateTrustedHtml(String(data.html));
    this.performTransition(
      rootElement,
      data,
      trustedHtml,
      preparedHead,
      retainedTitle,
      isPopState,
      scrollY,
    );
  }

  private updateDocumentMetadata(
    targetDocument: Document,
    data: RouteData,
    retainedTitle: string,
  ): void {
    updateRouteTitle(data.frontmatter?.title || retainedTitle, targetDocument);
    updateRouteMetaTags(data.frontmatter ?? {}, targetDocument);
  }

  private performTransition(
    rootElement: HTMLElement,
    data: RouteData,
    trustedHtml: string,
    preparedHead: ReturnType<typeof prepareClientRouteHeadEntries>,
    retainedTitle: string,
    isPopState: boolean,
    scrollY: number,
  ): void {
    rootElement.style.opacity = "0";
    this.pendingRoot = rootElement;

    this.pendingTransitionTimeout = setTimeout(() => {
      this.pendingTransitionTimeout = undefined;
      this.pendingRoot = undefined;
      try {
        // Every fallible payload check completed before the old route is
        // mutated. Scripted routes never enter this soft-transition path.
        retireClientHeadOwnership(rootElement.ownerDocument);
        rootElement.innerHTML = trustedHtml;
        applyHeadDirectives(rootElement);
        applyPreparedClientRouteHeadDescriptors(preparedHead, rootElement.ownerDocument);
        this.updateDocumentMetadata(rootElement.ownerDocument, data, retainedTitle);
        this.setupViewportPrefetch(rootElement);
        manageFocus(rootElement);
        this.handleScroll(isPopState, scrollY);
      } catch (error) {
        logger.error("Route transition commit failed; reloading the document", error);
        globalThis.location?.reload();
      } finally {
        rootElement.style.opacity = "1";
      }
    }, PAGE_TRANSITION_DELAY_MS);
  }

  private handleScroll(isPopState: boolean, scrollY: number): void {
    try {
      globalThis.scrollTo(0, isPopState ? scrollY : 0);
    } catch (error) {
      logger.warn("scroll handling failed", error);
    }
  }

  showError(error: Error): void {
    const rootElement = document.getElementById("root");
    if (!rootElement) return;

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

    retireClientHeadOwnership(rootElement.ownerDocument);
    rootElement.innerHTML = "";
    rootElement.appendChild(errorDiv);
  }

  setLoadingState(loading: boolean): void {
    const indicator = document.getElementById("veryfront-loading");
    if (indicator) indicator.style.display = loading ? "block" : "none";

    document.body.classList.toggle("veryfront-loading", loading);
  }
}
