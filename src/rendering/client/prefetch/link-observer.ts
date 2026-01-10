export interface LinkObserverOptions {
  rootMargin: string;
  delay: number;
  onLinkVisible: (link: HTMLAnchorElement) => void;
}

function isAnchorElement(element: Element): element is HTMLAnchorElement {
  return typeof HTMLAnchorElement !== "undefined"
    ? element instanceof HTMLAnchorElement
    : element.tagName === "A";
}

export class LinkObserver {
  private options: LinkObserverOptions;
  private intersectionObserver: IntersectionObserver | null = null;
  private mutationObserver: MutationObserver | null = null;
  private prefetchedUrls: Set<string>;
  private pendingTimeouts = new Map<number, ReturnType<typeof setTimeout>>();
  private elementTimeoutMap = new WeakMap<Element, number>();
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
      if (!entry.isIntersecting || !isAnchorElement(entry.target)) {
        continue;
      }

      const link = entry.target;

      // Reset counter if it gets too high (prevents unbounded growth in long-running sessions)
      if (this.timeoutCounter > 1_000_000) {
        this.timeoutCounter = 0;
      }
      const timeoutKey = this.timeoutCounter++;

      const timeoutId = setTimeout(() => {
        this.pendingTimeouts.delete(timeoutKey);
        this.elementTimeoutMap.delete(link);
        this.options.onLinkVisible(link);
      }, this.options.delay);

      this.pendingTimeouts.set(timeoutKey, timeoutId);
      this.elementTimeoutMap.set(link, timeoutKey);
    }
  }

  private observeLinks(): void {
    const links = document.querySelectorAll('a[href^="/"], a[href^="./"]');
    for (const link of links) {
      if (this.isValidLink(link as HTMLAnchorElement)) {
        this.intersectionObserver?.observe(link);
      }
    }
  }

  private setupMutationObserver(): void {
    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type !== "childList") continue;

        // Handle added nodes
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.observeElement(node as Element);
          }
        }

        // Handle removed nodes
        for (const node of mutation.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            this.clearElementTimeouts(node as Element);
          }
        }
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  private clearTimeoutForElement(element: Element): void {
    const timeoutKey = this.elementTimeoutMap.get(element);
    if (timeoutKey === undefined) return;

    const timeoutId = this.pendingTimeouts.get(timeoutKey);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pendingTimeouts.delete(timeoutKey);
    }
    this.elementTimeoutMap.delete(element);
  }

  private clearElementTimeouts(element: Element): void {
    // Clear timeout for the element itself if it's an anchor
    if (isAnchorElement(element)) {
      this.clearTimeoutForElement(element);
    }

    // Clear timeouts for any child links
    for (const link of element.querySelectorAll("a")) {
      this.clearTimeoutForElement(link);
    }
  }

  private observeElement(element: Element): void {
    if (isAnchorElement(element) && this.isValidLink(element)) {
      this.intersectionObserver?.observe(element);
    }

    for (const link of element.querySelectorAll('a[href^="/"], a[href^="./"]')) {
      if (isAnchorElement(link) && this.isValidLink(link)) {
        this.intersectionObserver?.observe(link);
      }
    }
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
    for (const [_, timeoutId] of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts.clear();
    this.timeoutCounter = 0;

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
