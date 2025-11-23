export interface LinkObserverOptions {
  rootMargin: string;
  delay: number;
  onLinkVisible: (link: HTMLAnchorElement) => void;
}

export class LinkObserver {
  private options: LinkObserverOptions;
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private prefetchedUrls: Set<string>;
  private pendingTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  private elementTimeoutMap = new WeakMap<Element, number>(); // Track which timeout belongs to which element
  private timeoutCounter = 0;

  constructor(options: LinkObserverOptions, prefetchedUrls: Set<string>) {
    this.options = options;
    this.prefetchedUrls = prefetchedUrls;
  }

  init(): void {
    this.createIntersectionObserver();
    this.observeLinks();
    this.setupMutationObserver();
  }

  private createIntersectionObserver(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersection(entries),
      { rootMargin: this.options.rootMargin },
    );
  }

  private handleIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const target = entry.target;
        let isAnchor = false;

        // Compatible check for anchor element
        if (typeof HTMLAnchorElement !== "undefined") {
          isAnchor = target instanceof HTMLAnchorElement;
        } else {
          isAnchor = target.tagName === "A";
        }

        if (!isAnchor) {
          continue;
        }

        const link = target as HTMLAnchorElement;
        const timeoutKey = this.timeoutCounter++;

        const timeoutId = setTimeout(() => {
          this.pendingTimeouts.delete(timeoutKey);
          this.elementTimeoutMap.delete(link);
          this.options.onLinkVisible(link);
        }, this.options.delay);

        this.pendingTimeouts.set(timeoutKey, timeoutId);
        this.elementTimeoutMap.set(link, timeoutKey); // Track element->timeout mapping
      }
    }
  }

  private observeLinks(): void {
    const links = document.querySelectorAll('a[href^="/"], a[href^="./"]');
    links.forEach((link) => {
      if (this.isValidLink(link as HTMLAnchorElement)) {
        this.intersectionObserver?.observe(link);
      }
    });
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          // Handle added nodes
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.observeElement(node as Element);
            }
          });

          // Handle removed nodes - clear pending timeouts to prevent memory leak
          mutation.removedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              this.clearElementTimeouts(node as Element);
            }
          });
        }
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private clearElementTimeouts(element: Element): void {
    // Clear timeout for the element itself if it's a link
    if (element.tagName === "A") {
      const timeoutKey = this.elementTimeoutMap.get(element);
      if (timeoutKey !== undefined) {
        const timeoutId = this.pendingTimeouts.get(timeoutKey);
        if (timeoutId) {
          clearTimeout(timeoutId);
          this.pendingTimeouts.delete(timeoutKey);
        }
        this.elementTimeoutMap.delete(element);
      }
    }

    // Clear timeouts for any child links
    const links = element.querySelectorAll("a");
    links.forEach((link) => {
      const timeoutKey = this.elementTimeoutMap.get(link);
      if (timeoutKey !== undefined) {
        const timeoutId = this.pendingTimeouts.get(timeoutKey);
        if (timeoutId) {
          clearTimeout(timeoutId);
          this.pendingTimeouts.delete(timeoutKey);
        }
        this.elementTimeoutMap.delete(link);
      }
    });
  }

  private observeElement(element: Element): void {
    // Check for anchor element with test environment compatibility
    const isAnchor = typeof HTMLAnchorElement !== "undefined"
      ? element instanceof HTMLAnchorElement
      : element.tagName === "A";

    if (isAnchor && this.isValidLink(element as HTMLAnchorElement)) {
      this.intersectionObserver?.observe(element);
    }

    const links = element.querySelectorAll('a[href^="/"], a[href^="./"]');
    links.forEach((link) => {
      const isLinkAnchor = typeof HTMLAnchorElement !== "undefined"
        ? link instanceof HTMLAnchorElement
        : link.tagName === "A";

      if (isLinkAnchor && this.isValidLink(link as HTMLAnchorElement)) {
        this.intersectionObserver?.observe(link);
      }
    });
  }

  private isValidLink(link: HTMLAnchorElement): boolean {
    if (link.hostname !== globalThis.location.hostname) return false;
    if (link.hasAttribute("download")) return false;
    if (link.target === "_blank") return false;

    const url = link.href;
    if (this.prefetchedUrls.has(url)) return false;
    if (url === globalThis.location.href) return false;

    if (link.hash && link.pathname === globalThis.location.pathname) {
      return false;
    }

    if (link.dataset.noPrefetch) return false;

    return true;
  }

  destroy(): void {
    // Clear all pending timeouts properly
    for (const [_, timeoutId] of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts.clear();

    // Disconnect observers
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
  }
}
