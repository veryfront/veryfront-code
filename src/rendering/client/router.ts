import { rendererLogger } from "#veryfront/utils";
import ReactDOM from "react-dom/client";
import type { Root } from "react-dom/client";
import type { GlobalWithReactDOM } from "#veryfront/types/global-guards.ts";
import {
  extractPageDataFromScript,
  NavigationHandlers,
  PageLoader,
  PageTransition,
  ViewportPrefetch,
} from "#veryfront/routing";
import type { RouteData, SpaPageData } from "#veryfront/routing";

const logger = rendererLogger.component("veryfront");

export type SpaNavigationHandler = (data: SpaPageData) => Promise<void>;

declare global {
  interface Window {
    __VERYFRONT_ROUTER_OPTS__?: Partial<RouterOptions>;
    __VERYFRONT_SPA_MODE__?: boolean;
    veryFrontRouter?: VeryfrontRouter;
  }

  // eslint-disable-next-line no-var
  var __VERYFRONT_ROUTER_OPTS__: Partial<RouterOptions> | undefined;
  // eslint-disable-next-line no-var
  var __VERYFRONT_SPA_MODE__: boolean | undefined;
}

interface GlobalWithRouter {
  veryFrontRouter?: VeryfrontRouter;
}

export type { RouteData, SpaPageData };

export interface RouterBootOptions extends RouterOptions {
  slug?: string;
}

export interface RouterOptions {
  baseUrl?: string;
  spaMode?: boolean;
  onNavigate?: (url: string) => void;
  onStart?: (url: string) => void;
  onComplete?: (url: string) => void;
  onError?: (error: Error) => void;
  prefetchDelay?: number;
  prefetch?: {
    hover?: boolean;
    viewport?: boolean;
  };
}

export class VeryfrontRouter {
  private baseUrl: string;
  private currentPath: string;
  private root: Root | null = null;
  private options: RouterOptions;
  private spaMode: boolean;
  private spaNavigationHandler: SpaNavigationHandler | null = null;

  private pageLoader: PageLoader;
  private navigationHandlers: NavigationHandlers;
  private pageTransition: PageTransition;
  private viewportPrefetch: ViewportPrefetch;

  /** React (and other) subscribers notified after every completed navigation. */
  private listeners = new Set<() => void>();

  private handleClick: (event: MouseEvent) => void;
  private handlePopState: (event: PopStateEvent) => void;
  private handleMouseOver: (event: MouseEvent) => void;

  constructor(options: RouterOptions = {}) {
    const globalOptions = this.loadGlobalOptions();
    this.options = { ...globalOptions, ...options };

    this.baseUrl = this.options.baseUrl || globalThis.location.origin;
    this.currentPath = globalThis.location.pathname;
    this.spaMode = this.options.spaMode ?? globalThis.__VERYFRONT_SPA_MODE__ ?? false;

    this.pageLoader = new PageLoader();
    this.navigationHandlers = new NavigationHandlers(
      this.options.prefetchDelay,
      this.options.prefetch,
    );
    this.pageTransition = new PageTransition((root) => this.viewportPrefetch.setup(root));
    this.viewportPrefetch = new ViewportPrefetch(
      (path) => this.prefetch(path),
      this.options.prefetch,
    );

    this.handleClick = this.navigationHandlers.createClickHandler({
      onNavigate: (url) => this.navigate(url),
      onPrefetch: (url) => this.prefetch(url),
    });
    this.handlePopState = this.navigationHandlers.createPopStateHandler({
      onNavigate: (url) => this.navigate(url, false),
      onPrefetch: (url) => this.prefetch(url),
    });
    this.handleMouseOver = this.navigationHandlers.createMouseOverHandler({
      onNavigate: (url) => this.navigate(url),
      onPrefetch: (url) => this.prefetch(url),
    });
  }

  registerNavigationHandler(handler: SpaNavigationHandler): void {
    logger.debug("Registering SPA navigation handler");
    this.spaNavigationHandler = handler;
    this.spaMode = true;
  }

  /**
   * Subscribe to navigation changes. The listener fires after every completed
   * navigation — full page loads, soft same-route (query-only) changes, and
   * popstate. Returns an unsubscribe function. Defined as an arrow property so
   * the reference is stable and correctly bound for `useSyncExternalStore`.
   */
  subscribe = (listener: () => void): () => void => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * The current href (`pathname` + `search`) — the snapshot React reads through
   * `useSyncExternalStore`. Bound arrow property for a stable reference.
   */
  getCurrentHref = (): string => {
    const loc = globalThis.location;
    return loc ? `${loc.pathname}${loc.search}` : "/";
  };

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logger.warn("router subscriber threw", error);
      }
    }
  }

  private pathnameOf(url: string): string {
    try {
      return new URL(url, this.baseUrl).pathname;
    } catch {
      return (url.split("?")[0]?.split("#")[0]) || this.currentPath;
    }
  }

  private loadGlobalOptions(): Partial<RouterOptions> {
    try {
      const options = globalThis.__VERYFRONT_ROUTER_OPTS__;
      if (!options) {
        logger.debug("No global options configured");
        return {};
      }
      return options;
    } catch (error) {
      logger.error("Failed to read global options:", error);
      return {};
    }
  }

  init(): void {
    logger.debug("Initializing client-side router");

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      logger.error("Root element not found");
      return;
    }

    const ReactDOMToUse = (globalThis as unknown as GlobalWithReactDOM).ReactDOM ?? ReactDOM;
    this.root = ReactDOMToUse.createRoot(rootElement);

    document.addEventListener("click", this.handleClick);
    globalThis.addEventListener("popstate", this.handlePopState);
    document.addEventListener("mouseover", this.handleMouseOver);

    this.viewportPrefetch.setup(document);
    this.cacheCurrentPage();
  }

  private cacheCurrentPage(): void {
    const pageData = extractPageDataFromScript();
    if (pageData) this.pageLoader.setCache(this.currentPath, pageData);
  }

  async navigate(url: string, pushState = true, replaceState = false): Promise<void> {
    logger.debug(`Navigating to ${url} (SPA mode: ${this.spaMode})`);

    const isSameRoute = this.pathnameOf(url) === this.pathnameOf(this.currentPath);

    this.navigationHandlers.saveScrollPosition(this.currentPath);
    this.options.onStart?.(url);

    if (replaceState) globalThis.history.replaceState({}, "", url);
    else if (pushState) globalThis.history.pushState({}, "", url);

    if (isSameRoute) {
      // Soft same-route navigation: a query-only (or hash-only) change on the
      // current page. Update the URL and notify subscribers so `useRouter()` /
      // `usePageContext()` re-render, without reloading or refetching the page.
      this.currentPath = url;
      this.notify();
      this.options.onComplete?.(url);
      this.options.onNavigate?.(url);
      return;
    }

    if (this.spaMode && this.spaNavigationHandler) {
      await this.loadSpaPage(url);
    } else {
      await this.loadPage(url);
    }

    this.notify();
    this.options.onNavigate?.(url);
  }

  private async loadSpaPage(path: string): Promise<void> {
    logger.debug(`Loading SPA page: ${path}`);

    try {
      const spaData = await this.pageLoader.loadSpaPageData(path);
      await this.spaNavigationHandler?.(spaData);

      this.currentPath = path;
      this.handleScrollAfterNavigation();
      this.options.onComplete?.(path);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to load SPA page ${path}`, normalizedError);
      this.options.onError?.(normalizedError);
      this.pageTransition.showError(normalizedError);
    }
  }

  private handleScrollAfterNavigation(): void {
    const isPopState = this.navigationHandlers.isPopState();
    const scrollY = this.navigationHandlers.getScrollPosition(this.currentPath);

    try {
      globalThis.scrollTo(0, isPopState ? scrollY : 0);
    } catch (error) {
      logger.warn("scroll handling failed", error);
    }

    this.navigationHandlers.clearPopStateFlag();
  }

  private async loadPage(path: string, updateUI = true): Promise<void> {
    if (this.pageLoader.isCached(path)) {
      logger.debug(`Loading ${path} from cache`);
      const data = this.pageLoader.getCached(path);

      if (data) {
        if (updateUI) this.updatePage(data);
        return;
      }

      logger.warn(`Cache entry for ${path} was unexpectedly null, fetching fresh data`);
    }

    this.pageTransition.setLoadingState(true);

    try {
      const data = await this.pageLoader.loadPage(path);

      if (updateUI) this.updatePage(data);

      this.currentPath = path;
      this.options.onComplete?.(path);
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to load ${path}`, normalizedError);
      this.options.onError?.(normalizedError);
      this.pageTransition.showError(normalizedError);
    } finally {
      this.pageTransition.setLoadingState(false);
    }
  }

  async prefetch(path: string): Promise<void> {
    if (this.spaMode) {
      await this.pageLoader.prefetchSpaPageData(path);
      return;
    }
    await this.pageLoader.prefetch(path);
  }

  private updatePage(data: RouteData): void {
    if (!this.root) return;

    const isPopState = this.navigationHandlers.isPopState();
    const scrollY = this.navigationHandlers.getScrollPosition(this.currentPath);

    this.pageTransition.updatePage(data, isPopState, scrollY);
    this.navigationHandlers.clearPopStateFlag();
  }

  destroy(): void {
    document.removeEventListener("click", this.handleClick);
    globalThis.removeEventListener("popstate", this.handlePopState);
    document.removeEventListener("mouseover", this.handleMouseOver);
    this.viewportPrefetch.disconnect();
    this.pageLoader.clearCache();
    this.navigationHandlers.clear();
    this.pageTransition.destroy();
  }
}

export function boot(options: RouterBootOptions = {}): VeryfrontRouter | null {
  if (typeof window === "undefined" || !globalThis.document) return null;

  const globalWithRouter = globalThis as GlobalWithRouter;
  if (globalWithRouter.veryFrontRouter) return globalWithRouter.veryFrontRouter;

  const { slug: _slug, ...routerOptions } = options;
  const router = new VeryfrontRouter(routerOptions);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => router.init(), { once: true });
  } else {
    router.init();
  }

  globalWithRouter.veryFrontRouter = router;
  return router;
}

if (typeof window !== "undefined" && globalThis.document) {
  boot();
}
