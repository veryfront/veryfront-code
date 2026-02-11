import { rendererLogger as logger } from "#veryfront/utils";

const log = logger.component("veryfront");

export class ViewportPrefetch {
  private observer: IntersectionObserver | null = null;
  private prefetchCallback: (path: string) => void;
  private prefetchOptions: { hover?: boolean; viewport?: boolean };

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

      this.observer?.disconnect();
      this.createObserver();
      this.observeLinks(root);
    } catch (error) {
      log.debug("setupViewportPrefetch failed", error);
    }
  }

  private createObserver(): void {
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!(entry.target instanceof HTMLAnchorElement)) continue;

          const href = entry.target.getAttribute("href");
          if (href) this.prefetchCallback(href);

          this.observer?.unobserve(entry.target);
        }
      },
      { rootMargin: "200px" },
    );
  }

  private observeLinks(root: Document | HTMLElement): void {
    const anchors = root.querySelectorAll<HTMLAnchorElement>('a[href]:not([target="_blank"])');
    const isViewportEnabled = Boolean(this.prefetchOptions.viewport);

    for (const anchor of anchors) {
      if (!this.shouldObserveAnchor(anchor, isViewportEnabled)) continue;
      this.observer?.observe(anchor);
    }
  }

  private shouldObserveAnchor(anchor: HTMLAnchorElement, isViewportEnabled: boolean): boolean {
    const href = anchor.getAttribute("href");
    if (!href) return false;
    if (href.startsWith("http") || href.startsWith("#")) return false;
    if (anchor.getAttribute("download")) return false;

    const prefetchAttribute = anchor.getAttribute("data-prefetch");
    if (prefetchAttribute === "false") return false;

    return prefetchAttribute === "viewport" || isViewportEnabled;
  }

  disconnect(): void {
    if (!this.observer) return;

    try {
      this.observer.disconnect();
    } catch (error) {
      log.warn("prefetchObserver.disconnect failed", error);
    } finally {
      this.observer = null;
    }
  }
}
