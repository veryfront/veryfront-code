import { rendererLogger as logger } from "@veryfront/utils";
import { PAGE_TRANSITION_DELAY_MS } from "@veryfront/config";
import { applyHeadDirectives, executeScripts, manageFocus, updateMetaTags } from "./dom-utils.ts";
import type { RouteData } from "./page-loader.ts";

export class PageTransition {
  private setupViewportPrefetch: (root: Document | HTMLElement) => void;
  private pendingTransitionTimeout?: number;

  constructor(setupViewportPrefetch: (root: Document | HTMLElement) => void) {
    this.setupViewportPrefetch = setupViewportPrefetch;
  }

  destroy(): void {
    if (this.pendingTransitionTimeout !== undefined) {
      clearTimeout(this.pendingTransitionTimeout);
      this.pendingTransitionTimeout = undefined;
    }
  }

  updatePage(data: RouteData, isPopState: boolean, scrollY: number): void {
    if (data.frontmatter?.title) {
      document.title = data.frontmatter.title;
    }

    updateMetaTags(data.frontmatter ?? {});

    const rootElement = document.getElementById("root");
    if (rootElement && (data.html ?? "") !== "") {
      this.performTransition(rootElement, data, isPopState, scrollY);
    }
  }

  private performTransition(
    rootElement: HTMLElement,
    data: RouteData,
    isPopState: boolean,
    scrollY: number,
  ): void {
    // Clear any pending transition
    if (this.pendingTransitionTimeout !== undefined) {
      clearTimeout(this.pendingTransitionTimeout);
    }

    rootElement.style.opacity = "0";

    this.pendingTransitionTimeout = setTimeout(() => {
      this.pendingTransitionTimeout = undefined;
      rootElement.innerHTML = String(data.html ?? "");
      rootElement.style.opacity = "1";

      executeScripts(rootElement);
      applyHeadDirectives(rootElement);
      this.setupViewportPrefetch(rootElement);
      manageFocus(rootElement);
      this.handleScroll(isPopState, scrollY);
    }, PAGE_TRANSITION_DELAY_MS);
  }

  private handleScroll(isPopState: boolean, scrollY: number): void {
    try {
      globalThis.scrollTo(0, isPopState ? scrollY : 0);
    } catch (error) {
      logger.warn("[router] scroll handling failed", error);
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
    message.textContent = error.message; // textContent auto-escapes

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload Page";
    button.onclick = () => globalThis.location.reload();

    errorDiv.appendChild(heading);
    errorDiv.appendChild(message);
    errorDiv.appendChild(button);

    rootElement.innerHTML = ""; // Clear existing content
    rootElement.appendChild(errorDiv);
  }

  setLoadingState(loading: boolean): void {
    const indicator = document.getElementById("veryfront-loading");
    if (indicator) {
      indicator.style.display = loading ? "block" : "none";
    }

    document.body.classList.toggle("veryfront-loading", loading);
  }
}
