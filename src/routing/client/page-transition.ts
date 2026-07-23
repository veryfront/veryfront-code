import { PAGE_TRANSITION_DELAY_MS } from "#veryfront/config";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rendererLogger } from "#veryfront/utils";
import { applyHeadDirectives, executeScripts, manageFocus, updateMetaTags } from "./dom-utils.ts";
import type { RouteData } from "./page-loader.ts";

const logger = rendererLogger.component("veryfront");

export class PageTransition {
  private pendingTransitionTimeout?: number;
  private pendingTransitionRoot?: HTMLElement;

  constructor(private setupViewportPrefetch: (root: Document | HTMLElement) => void) {}

  destroy(): void {
    this.cancelPendingTransition();
  }

  updatePage(data: RouteData, isPopState: boolean, scrollY: number): void {
    this.cancelPendingTransition();

    const title = data.frontmatter?.title;
    if (title) document.title = title;

    updateMetaTags(data.frontmatter ?? {});

    const rootElement = document.getElementById("root");
    if (!rootElement || data.html === undefined) return;

    const trustedHtml = validateTrustedHtml(data.html, { allowInlineScripts: true });

    this.performTransition(rootElement, trustedHtml, isPopState, scrollY);
  }

  private performTransition(
    rootElement: HTMLElement,
    trustedHtml: string,
    isPopState: boolean,
    scrollY: number,
  ): void {
    rootElement.style.opacity = "0";
    this.pendingTransitionRoot = rootElement;

    this.pendingTransitionTimeout = setTimeout(() => {
      this.pendingTransitionTimeout = undefined;
      this.pendingTransitionRoot = undefined;

      try {
        rootElement.innerHTML = trustedHtml;
        rootElement.style.opacity = "1";

        executeScripts(rootElement);
        applyHeadDirectives(rootElement);
        this.setupViewportPrefetch(rootElement);
        manageFocus(rootElement);
        this.handleScroll(isPopState, scrollY);
      } catch (error) {
        rootElement.style.opacity = "1";
        this.showError(error instanceof Error ? error : new Error("Page transition failed"));
      }
    }, PAGE_TRANSITION_DELAY_MS);
  }

  private cancelPendingTransition(): void {
    if (this.pendingTransitionTimeout !== undefined) {
      clearTimeout(this.pendingTransitionTimeout);
      this.pendingTransitionTimeout = undefined;
    }
    if (this.pendingTransitionRoot) this.pendingTransitionRoot.style.opacity = "1";
    this.pendingTransitionRoot = undefined;
  }

  private handleScroll(isPopState: boolean, scrollY: number): void {
    try {
      globalThis.scrollTo(0, isPopState ? scrollY : 0);
    } catch (error) {
      logger.warn("scroll handling failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  showError(error: Error): void {
    this.cancelPendingTransition();
    logger.error("page transition failed", { errorName: error.name });

    const rootElement = document.getElementById("root");
    if (!rootElement) return;
    rootElement.style.opacity = "1";

    const errorDiv = document.createElement("div");
    errorDiv.className = "veryfront-error-page";

    const heading = document.createElement("h1");
    heading.textContent = "Something went wrong";

    const message = document.createElement("p");
    message.textContent = "Reload the page and try again.";

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Reload page";
    button.onclick = () => globalThis.location.reload();

    errorDiv.append(heading, message, button);

    rootElement.innerHTML = "";
    rootElement.appendChild(errorDiv);
  }

  setLoadingState(loading: boolean): void {
    const indicator = document.getElementById("veryfront-loading");
    if (indicator) indicator.style.display = loading ? "block" : "none";

    document.body.classList.toggle("veryfront-loading", loading);
  }
}
