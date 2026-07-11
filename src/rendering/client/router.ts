import { rendererLogger } from "#veryfront/utils";
import { getNavigationStore, type HistoryMode, type NavigateOptions } from "./navigation-store.ts";
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

/**
 * Context passed to {@link RouterOptions.shouldRevalidate} to decide whether a
 * same-route navigation should refetch the page or update softly.
 */
export interface RevalidateContext {
  /** The href before this navigation. */
  currentHref: string;
  /** The href being navigated to. */
  nextHref: string;
  /** Whether the pathname is unchanged (only query/hash differ). */
  sameRoute: boolean;
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
  /**
   * Decides whether a navigation refetches page data. Called for same-route
   * navigations (query/hash-only changes); a route change always refetches.
   * Return `false` to take the soft fast path — update the URL and notify
   * subscribers without a network round-trip, for query used as client state.
   *
   * Defaults to always revalidating (React Router's default), because Veryfront
   * page data can depend on the query: the SPA loader fetches by full path +
   * query, and the render cache is keyed by query params (see the
   * `cache.queryParams` config). So the safe default never shows stale data.
   * Opt into the soft path when a page's query is purely client-side (tabs,
   * filters) and does not change server output.
   */
  shouldRevalidate?: (context: RevalidateContext) => boolean;
}

/** Normalize the deprecated boolean `pushState` arg or an options object. */
function toHistoryMode(options?: boolean | NavigateOptions): HistoryMode {
  // Deprecated boolean form: `navigate(url, pushState)` — true pushes, false
  // leaves history untouched (used by the popstate handler).
  if (typeof options === "boolean") return options ? "push" : "none";
  return options?.history ?? "push";
}

export class VeryfrontRouter {
  private baseUrl: string;
  private currentPath: string;
  private root: Root | null = null;
  private options: RouterOptions;
  private spaMode: boolean;
  private spaNavigationHandler: SpaNavigationHandler | null = null;
  private navigationSequence = 0;

  private pageLoader: PageLoader;
  private navigationHandlers: NavigationHandlers;
  private pageTransition: PageTransition;
  private viewportPrefetch: ViewportPrefetch;

  private handleClick: (event: MouseEvent) => void;
  private handlePopState: (event: PopStateEvent) => void;
  private handleMouseOver: (event: MouseEvent) => void;

  constructor(options: RouterOptions = {}) {
    const globalOptions = this.loadGlobalOptions();
    this.options = { ...globalOptions, ...options };

    this.baseUrl = this.options.baseUrl || globalThis.location.origin;
    this.currentPath =
      `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}`;
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
      // The browser already updated the URL for a popstate, so don't touch history.
      onNavigate: (url) => this.navigate(url, { history: "none" }),
      onPrefetch: (url) => this.prefetch(url),
    });
    this.handleMouseOver = this.navigationHandlers.createMouseOverHandler({
      onNavigate: (url) => this.navigate(url),
      onPrefetch: (url) => this.prefetch(url),
    });

    // Attach this router as the navigation implementation behind the shared
    // store, so `useRouter().push`/`replace` (in the React bundle) route through
    // real navigation. `navigate` accepts the store's options object directly.
    getNavigationStore().setNavigator((href, options) => this.navigate(href, options));
  }

  registerNavigationHandler(handler: SpaNavigationHandler): void {
    logger.debug("Registering SPA navigation handler");
    this.spaNavigationHandler = handler;
    this.spaMode = true;
  }

  /**
   * Notify React (and any other) subscribers that a navigation completed —
   * after full page loads, soft same-route changes, and popstate. Delegates to
   * the shared navigation store, the single subscription surface both bundles
   * share.
   */
  private notify(): void {
    getNavigationStore().notify();
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

  /**
   * Navigate to a URL. `options` selects the history behaviour: `{ history:
   * "push" }` (default), `"replace"`, or `"none"` (the URL already reflects the
   * target, as after popstate). A boolean is accepted for backward
   * compatibility — `true` pushes, `false` maps to `"none"`.
   */
  async navigate(url: string, options?: boolean | NavigateOptions): Promise<void> {
    logger.debug(`Navigating to ${url} (SPA mode: ${this.spaMode})`);

    const navigationId = ++this.navigationSequence;
    this.pageTransition.setLoadingState(false);
    const history = toHistoryMode(options);
    const sameRoute = this.pathnameOf(url) === this.pathnameOf(this.currentPath);

    this.navigationHandlers.saveScrollPosition(this.currentPath);
    this.options.onStart?.(url);

    if (history === "replace") globalThis.history.replaceState({}, "", url);
    else if (history === "push") globalThis.history.pushState({}, "", url);

    if (sameRoute && !this.shouldRevalidate(url, sameRoute)) {
      // Soft same-route navigation: the app opted out of revalidation because a
      // query-only (or hash-only) change is client state here. Update the URL
      // and notify subscribers so `useRouter()` / `usePageContext()` re-render,
      // without reloading or refetching the page.
      if (!this.isCurrentNavigation(navigationId)) return;
      this.currentPath = url;
      this.notify();
      this.options.onComplete?.(url);
      this.options.onNavigate?.(url);
      return;
    }

    if (this.spaMode && this.spaNavigationHandler) {
      await this.loadSpaPage(url, navigationId);
    } else {
      await this.loadPage(url, true, navigationId);
    }

    if (!this.isCurrentNavigation(navigationId)) return;
    this.notify();
    this.options.onNavigate?.(url);
  }

  private isCurrentNavigation(navigationId: number): boolean {
    return navigationId === this.navigationSequence;
  }

  /**
   * Whether a navigation should refetch page data. A route change always does;
   * a same-route (query/hash-only) change consults `options.shouldRevalidate`,
   * defaulting to `true` so server data is never shown stale.
   */
  private shouldRevalidate(nextUrl: string, sameRoute: boolean): boolean {
    const policy = this.options.shouldRevalidate;
    if (!policy) return true;
    return policy({ currentHref: this.currentPath, nextHref: nextUrl, sameRoute });
  }

  private async loadSpaPage(path: string, navigationId: number): Promise<void> {
    logger.debug(`Loading SPA page: ${path}`);

    try {
      const spaData = await this.pageLoader.loadSpaPageData(path);
      if (!this.isCurrentNavigation(navigationId)) return;
      await this.spaNavigationHandler?.(spaData);
      if (!this.isCurrentNavigation(navigationId)) return;

      this.currentPath = path;
      this.handleScrollAfterNavigation();
      this.options.onComplete?.(path);
    } catch (error) {
      if (!this.isCurrentNavigation(navigationId)) return;
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

  private async loadPage(path: string, updateUI = true, navigationId: number): Promise<void> {
    if (this.pageLoader.isCached(path)) {
      logger.debug(`Loading ${path} from cache`);
      const data = this.pageLoader.getCached(path);

      if (data) {
        if (!this.isCurrentNavigation(navigationId)) return;
        if (updateUI) this.updatePage(data, path);
        this.currentPath = path;
        this.pageTransition.setLoadingState(false);
        this.options.onComplete?.(path);
        return;
      }

      logger.warn(`Cache entry for ${path} was unexpectedly null, fetching fresh data`);
    }

    this.pageTransition.setLoadingState(true);

    try {
      const data = await this.pageLoader.loadPage(path);
      if (!this.isCurrentNavigation(navigationId)) return;

      if (updateUI) this.updatePage(data, path);

      this.currentPath = path;
      this.options.onComplete?.(path);
    } catch (error) {
      if (!this.isCurrentNavigation(navigationId)) return;
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      logger.error(`Failed to load ${path}`, normalizedError);
      this.options.onError?.(normalizedError);
      this.pageTransition.showError(normalizedError);
    } finally {
      if (this.isCurrentNavigation(navigationId)) this.pageTransition.setLoadingState(false);
    }
  }

  async prefetch(path: string): Promise<void> {
    if (this.spaMode) {
      await this.pageLoader.prefetchSpaPageData(path);
      return;
    }
    await this.pageLoader.prefetch(path);
  }

  private updatePage(data: RouteData, targetPath: string): void {
    if (!this.root) return;

    const isPopState = this.navigationHandlers.isPopState();
    const scrollY = this.navigationHandlers.getScrollPosition(targetPath);

    this.pageTransition.updatePage(data, isPopState, scrollY);
    this.navigationHandlers.clearPopStateFlag();
  }

  destroy(): void {
    this.navigationSequence++;
    this.pageTransition.setLoadingState(false);
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
