import { rendererLogger as logger } from "#veryfront/utils";
import { DEFAULT_PREFETCH_DELAY_MS } from "#veryfront/config";
import { findAnchorElement, isInternalLink } from "./dom-utils.ts";

export interface NavigationCallbacks {
  onNavigate: (url: string) => Promise<void>;
  onPrefetch: (url: string) => void;
}

// Maximum scroll positions to store (LRU eviction)
const MAX_SCROLL_POSITIONS = 100;

export class NavigationHandlers {
  private prefetchQueue = new Set<string>();
  private pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
  private scrollPositions = new Map<string, number>();
  private isPopStateNav = false;
  private prefetchDelay: number;
  private prefetchOptions: {
    hover?: boolean;
    viewport?: boolean;
  };

  constructor(
    prefetchDelay = DEFAULT_PREFETCH_DELAY_MS,
    prefetchOptions: { hover?: boolean; viewport?: boolean } = {},
  ) {
    this.prefetchDelay = prefetchDelay;
    this.prefetchOptions = prefetchOptions;
  }

  createClickHandler(callbacks: NavigationCallbacks) {
    return (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;

      const anchor = findAnchorElement(event.target);
      if (!anchor || !isInternalLink(anchor)) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      event.preventDefault();
      callbacks.onNavigate(href);
    };
  }

  createPopStateHandler(callbacks: NavigationCallbacks) {
    return (_event: PopStateEvent) => {
      const path = globalThis.location.pathname;
      this.isPopStateNav = true;
      callbacks.onNavigate(path);
    };
  }

  createMouseOverHandler(callbacks: NavigationCallbacks) {
    return (event: MouseEvent) => {
      if (!(event.target instanceof HTMLElement)) return;

      const target = event.target;
      if (target.tagName !== "A") return;

      const href = target.getAttribute("href");
      if (!href || href.startsWith("http") || href.startsWith("#")) return;

      if (!this.shouldPrefetchOnHover(target)) return;

      if (!this.prefetchQueue.has(href)) {
        this.prefetchQueue.add(href);
        const timeoutId = setTimeout(() => {
          callbacks.onPrefetch(href);
          this.prefetchQueue.delete(href);
          this.pendingTimeouts.delete(href);
        }, this.prefetchDelay);
        this.pendingTimeouts.set(href, timeoutId);
      }
    };
  }

  private shouldPrefetchOnHover(target: HTMLElement): boolean {
    const prefetchAttribute = target.getAttribute("data-prefetch");
    const isHoverEnabled = Boolean(this.prefetchOptions.hover);

    if (prefetchAttribute === "false") return false;

    return prefetchAttribute === "true" || isHoverEnabled;
  }

  saveScrollPosition(path: string): void {
    try {
      // LRU eviction if at capacity
      if (this.scrollPositions.size >= MAX_SCROLL_POSITIONS) {
        const oldest = this.scrollPositions.keys().next().value;
        if (oldest) this.scrollPositions.delete(oldest);
      }

      const scrollY = globalThis.scrollY;
      if (typeof scrollY === "number") {
        this.scrollPositions.set(path, scrollY);
      } else {
        logger.debug("[Veryfront] No valid scrollY value available");
        this.scrollPositions.set(path, 0);
      }
    } catch (error) {
      logger.warn("[Veryfront] failed to record scroll position", error);
    }
  }

  getScrollPosition(path: string): number {
    const position = this.scrollPositions.get(path);
    if (position === undefined) {
      logger.debug(`[Veryfront] No scroll position stored for ${path}`);
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
    for (const timeoutId of this.pendingTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts.clear();
    this.prefetchQueue.clear();
    this.scrollPositions.clear();
    this.isPopStateNav = false;
  }
}
