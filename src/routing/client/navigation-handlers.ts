import { rendererLogger } from "#veryfront/utils";
import { DEFAULT_PREFETCH_DELAY_MS } from "#veryfront/config";
import { findAnchorElement, isInternalLink } from "./dom-utils.ts";

const logger = rendererLogger.component("veryfront");

export interface NavigationCallbacks {
  onNavigate: (url: string) => Promise<void>;
  onPrefetch: (url: string) => void;
}

const MAX_SCROLL_POSITIONS = 100;
const MAX_PENDING_PREFETCHES = 100;

export class NavigationHandlers {
  private prefetchQueue = new Set<string>();
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private scrollPositions = new Map<string, number>();
  private isPopStateNav = false;
  private prefetchDelay: number;
  private prefetchOptions: { hover?: boolean; viewport?: boolean };

  constructor(
    prefetchDelay = DEFAULT_PREFETCH_DELAY_MS,
    prefetchOptions: { hover?: boolean; viewport?: boolean } = {},
  ) {
    this.prefetchDelay = prefetchDelay;
    this.prefetchOptions = prefetchOptions;
  }

  createClickHandler(callbacks: NavigationCallbacks) {
    return (event: MouseEvent) => {
      if (
        event.defaultPrevented || (event.button !== undefined && event.button !== 0) ||
        event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
      ) return;
      if (!(event.target instanceof HTMLElement)) return;

      const anchor = findAnchorElement(event.target);
      if (!anchor || !isInternalLink(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      event.preventDefault();
      void callbacks.onNavigate(href).catch((error) => {
        logger.error("client navigation failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
    };
  }

  createPopStateHandler(callbacks: NavigationCallbacks) {
    return (_event: PopStateEvent) => {
      this.isPopStateNav = true;
      const { pathname, search, hash } = globalThis.location;
      void callbacks.onNavigate(`${pathname}${search}${hash}`).catch((error) => {
        logger.error("popstate navigation failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      });
    };
  }

  createMouseOverHandler(callbacks: NavigationCallbacks) {
    return (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      const anchor = findAnchorElement(event.target);
      if (!anchor || !isInternalLink(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      if (!this.shouldPrefetchOnHover(anchor)) return;
      if (this.prefetchQueue.has(href)) return;
      if (this.pendingTimeouts.size >= MAX_PENDING_PREFETCHES) return;

      this.prefetchQueue.add(href);

      const timeoutId = setTimeout(() => {
        try {
          callbacks.onPrefetch(href);
        } catch (error) {
          logger.warn("client prefetch callback failed", {
            errorName: error instanceof Error ? error.name : typeof error,
          });
        } finally {
          this.prefetchQueue.delete(href);
          this.pendingTimeouts.delete(href);
        }
      }, this.prefetchDelay);

      this.pendingTimeouts.set(href, timeoutId);
    };
  }

  private shouldPrefetchOnHover(target: HTMLAnchorElement): boolean {
    const prefetchAttribute = target.getAttribute("data-prefetch");
    if (prefetchAttribute === "false") return false;
    if (prefetchAttribute === "true") return true;
    return Boolean(this.prefetchOptions.hover);
  }

  saveScrollPosition(path: string): void {
    try {
      if (!this.scrollPositions.has(path) && this.scrollPositions.size >= MAX_SCROLL_POSITIONS) {
        const oldest = this.scrollPositions.keys().next().value;
        if (oldest) this.scrollPositions.delete(oldest);
      }

      const scrollY = globalThis.scrollY;
      if (typeof scrollY !== "number") {
        logger.debug("No valid scrollY value available");
        this.scrollPositions.set(path, 0);
        return;
      }

      this.scrollPositions.set(path, scrollY);
    } catch (error) {
      logger.warn("failed to record scroll position", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  getScrollPosition(path: string): number {
    const position = this.scrollPositions.get(path);
    if (position === undefined) {
      logger.debug("No scroll position stored for navigation target");
      return 0;
    }
    return position;
  }

  isPopState(): boolean {
    return this.isPopStateNav;
  }

  clearPopStateFlag(): void {
    this.isPopStateNav = false;
  }

  clear(): void {
    for (const timeoutId of this.pendingTimeouts.values()) clearTimeout(timeoutId);
    this.pendingTimeouts.clear();
    this.prefetchQueue.clear();
    this.scrollPositions.clear();
    this.isPopStateNav = false;
  }
}
