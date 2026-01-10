import { rendererLogger as logger } from "@veryfront/utils";

export class ViewportPrefetch {
  private observer: IntersectionObserver | null = null;
  private prefetchCallback: (path: string) => void;
  private prefetchOptions: {
    hover?: boolean;
    viewport?: boolean;
  };

  constructor(
    prefetchCallback: (path: string) => void,
    prefetchOptions: { hover?: boolean; viewport?: boolean } = {},
  ) {
    this.prefetchCallback = prefetchCallback;
    this.prefetchOptions = prefetchOptions;
  }

  setup(root: Document | HTMLElement): void {
    try {
      if (!("IntersectionObserver" in globalThis)) return;

      if (this.observer) this.observer.disconnect();

      this.createObserver();
      this.observeLinks(root);
    } catch (error) {
      logger.debug("[Veryfront] setupViewportPrefetch failed", error);
    }
  }

  private createObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // Check if target is an anchor element
            if (entry.target instanceof HTMLAnchorElement) {
              const href = entry.target.getAttribute("href");
              if (href) {
                this.prefetchCallback(href);
              }
              this.observer?.unobserve(entry.target);
            }
          }
        }
      },
      { rootMargin: "200px" },
    );
  }

  private observeLinks(root: Document | HTMLElement): void {
    const anchors: NodeListOf<HTMLAnchorElement> =
      root.querySelectorAll?.('a[href]:not([target="_blank"])') ??
        document.createDocumentFragment().querySelectorAll("a");
    const isViewportEnabled = Boolean(this.prefetchOptions.viewport);

    for (const anchor of anchors) {
      if (this.shouldObserveAnchor(anchor, isViewportEnabled)) {
        this.observer?.observe(anchor);
      }
    }
  }

  private shouldObserveAnchor(anchor: HTMLAnchorElement, isViewportEnabled: boolean): boolean {
    const href = anchor.getAttribute("href") || "";
    if (
      !href || href.startsWith("http") || href.startsWith("#") || anchor.getAttribute("download")
    ) {
      return false;
    }

    const prefetchAttribute = anchor.getAttribute("data-prefetch");
    if (prefetchAttribute === "false") return false;

    return prefetchAttribute === "viewport" || isViewportEnabled;
  }

  disconnect(): void {
    if (this.observer) {
      try {
        this.observer.disconnect();
      } catch (error) {
        logger.warn("[Veryfront] prefetchObserver.disconnect failed", error);
      }
      this.observer = null;
    }
  }
}
