import { rendererLogger as logger } from "@veryfront/utils";
import ReactDOM from "react-dom/client";
import type { GlobalWithReactDOM } from "@veryfront/types/global-guards.ts";
import { extractPageDataFromScript } from "@veryfront/routing";
import { NavigationHandlers } from "@veryfront/routing";
import type { RouteData } from "@veryfront/routing";
import { PageLoader } from "@veryfront/routing";
import { PageTransition } from "@veryfront/routing";
import { ViewportPrefetch } from "@veryfront/routing";

declare global {
  interface Window {
    __VERYFRONT_ROUTER_OPTS__?: Partial<RouterOptions>;
    veryFrontRouter?: VeryfrontRouter;
  }

  var __VERYFRONT_ROUTER_OPTS__: Partial<RouterOptions> | undefined;
}

export type { RouteData };

export interface RouterOptions {
  baseUrl?: string;
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
  private root: ReactDOM.Root | null = null;
  private options: RouterOptions;

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
    this.baseUrl = options.baseUrl || globalThis.location.origin;
    this.currentPath = globalThis.location.pathname;

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

  private loadGlobalOptions(): Partial<RouterOptions> {
    try {
      const options = globalThis.__VERYFRONT_ROUTER_OPTS__;
      if (!options) {
        logger.debug("[router] No global options configured");
        return {};
      }
      return options;
    } catch (error) {
      logger.error("[router] Failed to read global options:", error);
      return {};
    }
  }

  init() {
    logger.info("Initializing client-side router");

    const rootElement = document.getElementById("root");
    if (!rootElement) {
      logger.error("Root element not found");
      return;
    }

    const ReactDOMToUse = (globalThis as GlobalWithReactDOM).ReactDOM || ReactDOM;
    this.root = ReactDOMToUse.createRoot(rootElement);

    document.addEventListener("click", this.handleClick);
    globalThis.addEventListener("popstate", this.handlePopState);
    document.addEventListener("mouseover", this.handleMouseOver);

    this.viewportPrefetch.setup(document);
    this.cacheCurrentPage();
  }

  private cacheCurrentPage(): void {
    const pageData = extractPageDataFromScript();
    if (pageData) {
      this.pageLoader.setCache(this.currentPath, pageData);
    }
  }

  async navigate(url: string, pushState = true): Promise<void> {
    logger.info(`Navigating to ${url}`);

    this.navigationHandlers.saveScrollPosition(this.currentPath);
    this.options.onStart?.(url);

    if (pushState) {
      globalThis.history.pushState({}, "", url);
    }

    await this.loadPage(url);
    this.options.onNavigate?.(url);
  }

  private async loadPage(path: string, updateUI = true): Promise<void> {
    if (this.pageLoader.isCached(path)) {
      logger.debug(`Loading ${path} from cache`);
      const data = this.pageLoader.getCached(path);
      if (!data) {
        logger.warn(`[router] Cache entry for ${path} was unexpectedly null, fetching fresh data`);
        // Fall through to fetch fresh data
      } else {
        if (updateUI) {
          this.updatePage(data);
        }
        return;
      }
    }

    this.pageTransition.setLoadingState(true);

    try {
      const data = await this.pageLoader.loadPage(path);

      if (updateUI) {
        this.updatePage(data);
      }

      this.currentPath = path;
      this.options.onComplete?.(path);
    } catch (error) {
      logger.error(`Failed to load ${path}`, error as Error);
      this.options.onError?.(error as Error);
      this.pageTransition.showError(error as Error);
    } finally {
      this.pageTransition.setLoadingState(false);
    }
  }

  async prefetch(path: string): Promise<void> {
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

if (typeof window !== "undefined" && globalThis.document) {
  const router = new VeryfrontRouter();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => router.init());
  } else {
    router.init();
  }

  (globalThis as any).veryFrontRouter = router;
}
