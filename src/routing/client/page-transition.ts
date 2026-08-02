import { PAGE_TRANSITION_DELAY_MS } from "#veryfront/config";
import { retireClientHeadOwnership } from "#veryfront/html/client-head-manager.ts";
import {
  applyClientRouteHeadEntries,
  updateRouteMetaTags,
  updateRouteTitle,
} from "#veryfront/html/client-route-head.ts";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rendererLogger } from "#veryfront/utils";
import { applyHeadDirectives, executeScripts, manageFocus } from "./dom-utils.ts";
import type { RouteData } from "./page-loader.ts";

const logger = rendererLogger.component("veryfront");

export class PageTransition {
  private pendingTransitionTimeout?: number;

  constructor(private setupViewportPrefetch: (root: Document | HTMLElement) => void) {}

  destroy(): void {
    if (this.pendingTransitionTimeout === undefined) return;
    clearTimeout(this.pendingTransitionTimeout);
    this.pendingTransitionTimeout = undefined;
  }

  updatePage(data: RouteData, isPopState: boolean, scrollY: number): void {
    const rootElement = document.getElementById("root");
    if (!rootElement || !data.html) {
      retireClientHeadOwnership(document);
      applyClientRouteHeadEntries(data.managedHead, document);
      this.updateDocumentMetadata(document, data);
      return;
    }

    this.performTransition(rootElement, data, isPopState, scrollY);
  }

  private updateDocumentMetadata(targetDocument: Document, data: RouteData): void {
    updateRouteTitle(data.frontmatter?.title, targetDocument);
    updateRouteMetaTags(data.frontmatter ?? {}, targetDocument);
  }

  private performTransition(
    rootElement: HTMLElement,
    data: RouteData,
    isPopState: boolean,
    scrollY: number,
  ): void {
    if (this.pendingTransitionTimeout !== undefined) {
      clearTimeout(this.pendingTransitionTimeout);
      this.pendingTransitionTimeout = undefined;
    }

    rootElement.style.opacity = "0";

    this.pendingTransitionTimeout = setTimeout(() => {
      this.pendingTransitionTimeout = undefined;

      // Server-rendered navigation HTML may include framework-managed scripts.
      const trustedHtml = validateTrustedHtml(String(data.html), {
        allowInlineScripts: true,
      });
      // Replacing the React root disconnects every <Head> registration. Retire
      // its document-level ownership first even when the destination has no
      // legacy head directive, otherwise stale canonical/style/script nodes
      // survive indefinitely.
      retireClientHeadOwnership(rootElement.ownerDocument);
      rootElement.innerHTML = trustedHtml;
      rootElement.style.opacity = "1";

      // Route head directives retain precedence over frontmatter metadata.
      // Commit the marked frontmatter baseline afterwards; it fills missing
      // singleton slots but never mutates or overrides a directive-owned node.
      applyHeadDirectives(rootElement);
      applyClientRouteHeadEntries(data.managedHead, rootElement.ownerDocument);
      this.updateDocumentMetadata(rootElement.ownerDocument, data);
      executeScripts(rootElement);
      this.setupViewportPrefetch(rootElement);
      manageFocus(rootElement);
      this.handleScroll(isPopState, scrollY);
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
