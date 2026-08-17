/**
 * The SPA router: page-data fetching and caching, navigation, prefetching,
 * scroll memory, and re-rendering a route from its page data.
 */

import type {
  ClientRouter,
  HydrationRuntimeEnv,
  PageDataPayload,
  RuntimeDocument,
  RuntimeElement,
  RuntimeEvent,
  RuntimeFetchInit,
  RuntimeResponse,
} from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";
import {
  getDocumentNonce,
  isAbortError,
  normalizeRouteParams,
  resolveDocumentNavigationUrl,
} from "./shared.ts";
import type { RouteTimingRecorder } from "./route-timing.ts";
import { routeTimingNow } from "./route-timing.ts";
import type { ComponentLoader } from "./component-loader.ts";
import type { SnapshotModuleImporter } from "./snapshot-modules.ts";
import { isDependencySnapshotConflict } from "./snapshot-modules.ts";
import type { NavigationStore } from "./navigation-store.ts";
import {
  assertPageDataMatchesDocumentSnapshot,
  buildPageDataEndpoint,
  buildPinnedRscModuleUrl,
  pageDataCacheIdentity as buildPageDataCacheIdentity,
} from "./module-urls.ts";
import { handoffClientRouteMetadata } from "#veryfront/html/client-route-head.ts";

const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const MAX_CACHE_SIZE = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const BACKGROUND_REFRESH_INTERVAL_MS = 30 * 1000;
const PREFETCH_DELAY_MS = 100;
const MAX_PREFETCH_PATHS = 100;
const IDLE_PREFETCH_DELAY_MS = 1200;
const IDLE_PREFETCH_MAX_LINKS = 4;
const VIEWPORT_PREFETCH_MAX_LINKS = 8;
const PAGE_DATA_PREFETCH_CONCURRENCY = 2;
const VIEWPORT_PREFETCH_ROOT_MARGIN = "200px";
const MAX_SCROLL_POSITIONS = 100;

export type HistoryMode = "push" | "replace" | "none";

export interface RouterRuntimeDeps {
  env: HydrationRuntimeEnv;
  logging: RuntimeLogging;
  routeTiming: RouteTimingRecorder;
  componentLoader: ComponentLoader;
  snapshotModules: SnapshotModuleImporter;
  initialHydrationData: PageDataPayload;
  documentDependencyPinningCacheKey: string | null;
  getNavigationStore: () => NavigationStore;
  navigationStoreUsesRegistryFallback: boolean;
}

export interface RouterRuntime {
  router: ClientRouter;
  navigateSPA(href: string, historyMode?: HistoryMode, restoreScroll?: boolean): Promise<void>;
  renderPageFromData(pageData: PageDataPayload, targetPath: string): Promise<void>;
  prefetchPage(href: string): void;
  /** Renderer signals initial hydration through these, as it always has. */
  signalHydrationComplete(): void;
  signalHydrationFailed(error: unknown): void;
}

interface PageDataFetchOptions {
  triggerReloadOnVersionMismatch?: boolean;
  recordRouteTiming?: boolean;
  timingSource?: string;
  prefetch?: boolean;
  trackPending?: boolean;
}

interface BuildVersionLike {
  framework?: string;
  serverStart?: number;
  projectUpdated?: string;
}

export function createRouterRuntime(deps: RouterRuntimeDeps): RouterRuntime {
  const { env, logging, routeTiming, componentLoader, snapshotModules } = deps;
  const { window, document, React, RouterProvider, PageContextProvider } = env;
  // Shadow the globals so every timer in this module goes through the env.
  const { setTimeout, clearTimeout } = env;
  const { log, logError, logBackgroundFetchFailure, perfStart, perfEnd } = logging;
  const { emitRouteTiming, buildPageDataTimingDetail } = routeTiming;
  const { loadComponent } = componentLoader;
  const documentPinKey = deps.documentDependencyPinningCacheKey;

  // ============================================
  // Hydration state tracking
  // ============================================
  let hydrationResolve!: () => void;
  let hydrationReject!: (error: unknown) => void;
  const hydrationPromise = new Promise<void>((resolve, reject) => {
    hydrationResolve = resolve;
    hydrationReject = reject;
  });
  let hydrationCompleted = false;
  let hydrationFailed = false;

  function signalHydrationComplete(): void {
    hydrationCompleted = true;
    hydrationResolve();
    log("Hydration complete signal received");
  }

  function signalHydrationFailed(error: unknown): void {
    hydrationFailed = true;
    hydrationReject(error);
    logError("Hydration failed signal received:", error);
  }

  window.__veryfrontHydrationComplete = signalHydrationComplete;
  window.__veryfrontHydrationFailed = signalHydrationFailed;

  function pageDataCacheIdentity(path: string): string {
    return buildPageDataCacheIdentity(path, documentPinKey);
  }

  /**
   * Leaves the SPA for `target`. When the target is not a safe document
   * navigation, reloads the current route instead — the user still escapes the
   * broken SPA state, without the runtime executing a URL it could not vet.
   */
  function navigateDocument(target: string, options: { replace?: boolean } = {}): void {
    const safeUrl = resolveDocumentNavigationUrl(target, window.location.origin);
    if (safeUrl) {
      if (options.replace && window.location.replace) {
        window.location.replace(safeUrl);
      } else {
        window.location.href = safeUrl;
      }
      return;
    }

    logError("Refusing an unsafe document navigation:", target);
    window.location.reload();
  }

  // ============================================
  // Version tracking for cache invalidation
  // ============================================
  let clientBuildVersion: BuildVersionLike | null = null;

  function checkVersionMismatch(newVersion: BuildVersionLike): boolean {
    if (!clientBuildVersion) {
      clientBuildVersion = newVersion;
      log("Build version initialized:", newVersion);
      return false;
    }

    if (newVersion.serverStart !== clientBuildVersion.serverStart) {
      log("Server restarted, reloading...", {
        old: clientBuildVersion.serverStart,
        new: newVersion.serverStart,
      });
      return true;
    }

    if (newVersion.framework !== clientBuildVersion.framework) {
      log("Framework version changed, reloading...", {
        old: clientBuildVersion.framework,
        new: newVersion.framework,
      });
      return true;
    }

    if (
      newVersion.projectUpdated &&
      clientBuildVersion.projectUpdated &&
      newVersion.projectUpdated !== clientBuildVersion.projectUpdated
    ) {
      log("Project content updated, reloading...", {
        old: clientBuildVersion.projectUpdated,
        new: newVersion.projectUpdated,
      });
      return true;
    }

    return false;
  }

  // ============================================
  // LRU cache with TTL (single Map to prevent sync issues)
  // ============================================
  const pageDataCache = new Map<string, { data: PageDataPayload; timestamp: number }>();
  const pendingPageDataFetches = new Map<string, Promise<PageDataPayload>>();
  const backgroundRefreshTimestamps = new Map<string, number>();

  function getCachedPageData(path: string): PageDataPayload | null {
    const cacheIdentity = pageDataCacheIdentity(path);
    const entry = pageDataCache.get(cacheIdentity);
    if (!entry) return null;

    if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;

    pageDataCache.delete(cacheIdentity);
    backgroundRefreshTimestamps.delete(cacheIdentity);
    return null;
  }

  function setCachedPageData(path: string, data: PageDataPayload): void {
    const cacheIdentity = pageDataCacheIdentity(path);
    if (pageDataCache.size >= MAX_CACHE_SIZE) {
      const oldest = pageDataCache.keys().next().value;
      if (oldest) {
        pageDataCache.delete(oldest);
        backgroundRefreshTimestamps.delete(oldest);
      }
    }

    pageDataCache.set(cacheIdentity, { data, timestamp: Date.now() });
  }

  // ============================================
  // Scroll position memory (bounded)
  // ============================================
  const scrollPositions = new Map<string, number>();

  function saveScrollPosition(path: string): void {
    if (scrollPositions.size >= MAX_SCROLL_POSITIONS) {
      const oldest = scrollPositions.keys().next().value;
      if (oldest) scrollPositions.delete(oldest);
    }
    scrollPositions.set(path, window.scrollY);
  }

  function restoreScrollPosition(path: string): boolean {
    const savedY = scrollPositions.get(path);
    if (savedY === undefined) return false;

    requestAnimationFrame(() => window.scrollTo(0, savedY));
    return true;
  }

  // ============================================
  // Loading progress indicator
  // ============================================
  let progressBar: RuntimeElement | null = null;
  let progressTimeout: number | null = null;

  function showNavigationProgress(): void {
    if (!progressBar) {
      progressBar = document.createElement("div");
      progressBar.id = "vf-nav-progress";
      progressBar.style.cssText =
        "position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#0066ff,#00aaff);z-index:99999;transition:width 0.3s ease-out,opacity 0.2s;opacity:1;";
      document.body.prepend(progressBar);
    }

    progressBar.style.opacity = "1";
    progressBar.style.width = "30%";

    progressTimeout = setTimeout(() => {
      if (progressBar?.style) progressBar.style.width = "70%";
    }, 300);

    document.body.setAttribute("aria-busy", "true");
  }

  function hideNavigationProgress(): void {
    if (progressTimeout) {
      clearTimeout(progressTimeout);
      progressTimeout = null;
    }

    if (progressBar) {
      progressBar.style.width = "100%";
      setTimeout(() => {
        if (!progressBar) return;

        progressBar.style.opacity = "0";
        setTimeout(() => {
          if (progressBar) progressBar.style.width = "0";
        }, 200);
      }, 150);
    }

    document.body.removeAttribute("aria-busy");
  }

  // ============================================
  // Fetch with timeout, retry, and abort support
  // ============================================
  let currentAbortController: AbortController | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchWithRetry(
    url: string,
    options: RuntimeFetchInit,
    maxRetries = MAX_RETRIES,
  ): Promise<RuntimeResponse> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const callerSignal = options.signal;
      const abortFromCaller = () => controller.abort();
      if (callerSignal?.aborted) controller.abort();
      callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const response = await env.fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", abortFromCaller);

        if (response.ok) return response;

        if (response.status >= 500 && attempt < maxRetries) {
          log("Server error, retrying...", response.status);
          await sleep(Math.pow(2, attempt) * 500);
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", abortFromCaller);

        if ((error as Error).name === "AbortError" && callerSignal?.aborted) throw error;
        if (attempt === maxRetries) throw error;

        log("Fetch failed, retrying...", (error as Error).message);
        await sleep(Math.pow(2, attempt) * 500);
      }
    }

    throw new Error("Failed to fetch page data");
  }

  // ============================================
  // Page data fetching with caching
  // ============================================
  async function fetchPageDataFresh(
    path: string,
    signal: AbortSignal | null,
    options: PageDataFetchOptions = {},
  ): Promise<PageDataPayload> {
    const {
      triggerReloadOnVersionMismatch = false,
      recordRouteTiming = false,
      timingSource = "network",
    } = options;
    const endpoint = buildPageDataEndpoint(path, window.location.origin);
    const startedAt = recordRouteTiming ? routeTimingNow() : 0;

    log("Fetching page data:", path);
    perfStart("fetch:" + path);

    const headers: Record<string, string> = options.prefetch
      ? { "X-Veryfront-Prefetch": "1" }
      : { "X-Veryfront-Navigation": "spa" };
    if (documentPinKey) {
      headers["X-Veryfront-Dependency-Pins"] = documentPinKey;
    }
    const response = await fetchWithRetry(endpoint, {
      headers,
      signal,
    }, options.prefetch ? 0 : MAX_RETRIES);

    if (!response.ok) {
      perfEnd("fetch:" + path);
      if (recordRouteTiming) {
        emitRouteTiming(
          "page-data",
          path,
          startedAt,
          buildPageDataTimingDetail(response, endpoint, startedAt, timingSource),
        );
      }
      const error = new Error("Failed to fetch page data: " + response.status) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    perfStart("parse:" + path);
    const data = assertPageDataMatchesDocumentSnapshot(
      path,
      await response.json() as PageDataPayload,
      documentPinKey,
    );
    perfEnd("parse:" + path);
    perfEnd("fetch:" + path);
    if (recordRouteTiming) {
      emitRouteTiming(
        "page-data",
        path,
        startedAt,
        buildPageDataTimingDetail(response, endpoint, startedAt, timingSource),
      );
    }

    if (triggerReloadOnVersionMismatch) {
      const checkedData = handlePageDataVersionMismatch(path, data);
      if (checkedData !== data) return checkedData;
    }

    setCachedPageData(path, data);
    return data;
  }

  function handlePageDataVersionMismatch(
    path: string,
    data: PageDataPayload,
  ): PageDataPayload | Promise<PageDataPayload> {
    if (data.buildVersion && checkVersionMismatch(data.buildVersion)) {
      log("Version mismatch detected, performing full page reload to:", path);
      navigateDocument(path);
      return new Promise<PageDataPayload>(() => {});
    }

    return data;
  }

  function startPageDataFetch(
    path: string,
    signal: AbortSignal | null,
    options: PageDataFetchOptions = {},
  ): Promise<PageDataPayload> {
    const cacheIdentity = pageDataCacheIdentity(path);
    const request = fetchPageDataFresh(path, signal, options).finally(() => {
      if (
        options.trackPending !== false &&
        pendingPageDataFetches.get(cacheIdentity) === request
      ) {
        pendingPageDataFetches.delete(cacheIdentity);
      }
    });
    if (options.trackPending !== false) {
      pendingPageDataFetches.set(cacheIdentity, request);
    }
    return request;
  }

  function fetchPageDataDeduped(path: string): Promise<PageDataPayload> {
    const pending = pendingPageDataFetches.get(pageDataCacheIdentity(path));
    if (pending) return pending;

    return startPageDataFetch(path, null);
  }

  function refreshPageDataInBackground(path: string): void {
    const cacheIdentity = pageDataCacheIdentity(path);
    const lastRefreshAt = backgroundRefreshTimestamps.get(cacheIdentity) || 0;
    const now = Date.now();
    if (now - lastRefreshAt < BACKGROUND_REFRESH_INTERVAL_MS) return;

    backgroundRefreshTimestamps.set(cacheIdentity, now);
    fetchPageDataDeduped(path).catch((error) => {
      logBackgroundFetchFailure("Stale page data refresh", path, error);
    });
  }

  async function fetchPageDataForNavigation(
    path: string,
    signal: AbortSignal | null,
  ): Promise<PageDataPayload> {
    const startedAt = routeTimingNow();
    const cached = getCachedPageData(path);
    if (cached) {
      log("Using cached page data:", path);
      // A route that leaves the SPA never renders this payload client-side,
      // so refreshing it in the background is wasted work.
      if (!cached.requiresFullDocumentNavigation) {
        refreshPageDataInBackground(path);
      }
      emitRouteTiming("page-data", path, startedAt, { source: "cache" });
      return cached;
    }

    const pending = pendingPageDataFetches.get(pageDataCacheIdentity(path));
    if (pending) {
      log("Reusing pending page data fetch for navigation:", path);
      const data = await pending;
      emitRouteTiming("page-data", path, startedAt, { source: "deduped" });
      return handlePageDataVersionMismatch(path, data);
    }

    return startPageDataFetch(path, signal, {
      triggerReloadOnVersionMismatch: true,
      recordRouteTiming: true,
      timingSource: "network",
    });
  }

  function fetchPageDataForPrefetch(path: string, signal: AbortSignal | null): Promise<void> {
    if (getCachedPageData(path)) return Promise.resolve();
    return startPageDataFetch(path, signal, { prefetch: true, trackPending: false })
      .then((data) => preloadModulesForPageData(data, path))
      .catch((error) => {
        if (!isAbortError(error)) {
          logBackgroundFetchFailure("Page data prefetch", path, error);
        }
        throw error;
      });
  }

  // ============================================
  // Navigation state
  // ============================================
  let currentPath = window.location.pathname;
  let isNavigating = false;

  // ============================================
  // SPA navigation handler
  // ============================================
  async function navigateSPA(
    href: string,
    historyMode: HistoryMode = "push",
    restoreScroll = false,
  ): Promise<void> {
    currentAbortController?.abort();

    if (isNavigating) return;
    isNavigating = true;
    const [navigationPath] = href.split("#");
    removeQueuedPrefetch(navigationPath || href);
    abortActiveSpeculativePrefetches();

    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;
    const navigationStartedAt = routeTimingNow();

    showNavigationProgress();
    perfStart("nav:total:" + href);

    try {
      log("SPA navigating to:", href);

      saveScrollPosition(currentPath);

      const [path, hash] = href.split("#");
      const targetPath = path || currentPath;

      perfStart("nav:fetchData:" + href);
      const pageData = await fetchPageDataForNavigation(targetPath, signal);
      perfEnd("nav:fetchData:" + href);

      if (signal.aborted) return;

      // getServerData redirect(): the page-data endpoint encodes it as a 200
      // { redirect: { destination } } payload. Follow it with a document
      // navigation to the target (the same net effect as the full-page 302),
      // instead of trying to render a page that does not exist here. An unsafe
      // or unparseable destination falls through to the normal error path
      // rather than reloading, which is what it did before the scheme check
      // moved into resolveDocumentNavigationUrl.
      if (pageData && pageData.redirect && typeof pageData.redirect.destination === "string") {
        const redirectBaseUrl = resolveDocumentNavigationUrl(
          targetPath,
          window.location.origin,
        );
        const redirectUrl = redirectBaseUrl
          ? resolveDocumentNavigationUrl(pageData.redirect.destination, redirectBaseUrl)
          : null;
        if (redirectUrl) {
          log("SPA navigation redirect -> " + redirectUrl);
          window.location.href = redirectUrl;
          return;
        }
      }

      // A server-owned layout only exists in the document render, so the SPA
      // cannot rebuild this route client-side. Handing it to the browser's
      // document loader is the designed path for these routes, not a failure —
      // and the loader owns the history entry, so nothing is pushed here.
      if (pageData.requiresFullDocumentNavigation) {
        log("Server layout requires a full document navigation:", href);
        // Progress state is restored first: if the unload is cancelled (a
        // beforeunload guard on the current page), the document stays alive
        // and must not remain aria-busy behind a stuck progress bar.
        hideNavigationProgress();
        // Only an explicit push may grow the history stack. "replace" must
        // replace, and "none" (popstate) is already on the target entry — an
        // href assignment there would push a duplicate.
        navigateDocument(href, { replace: historyMode !== "push" });
        return;
      }

      if (historyMode === "push") {
        window.history.pushState({ pageData, scrollY: 0 }, "", href);
      } else if (historyMode === "replace") {
        window.history.replaceState({ pageData, scrollY: 0 }, "", href);
      }

      // Update the shared router snapshot BEFORE rendering. RouterProvider
      // reads router.params during render, so mutating after renderPageFromData
      // would leave the new page's first render with the previous route's
      // params (issue #2741). pathname/query move up for the same reason.
      currentPath = targetPath;
      router.pathname = targetPath;
      router.query = Object.fromEntries(new URLSearchParams(window.location.search));
      router.params = normalizeRouteParams(pageData.params);

      perfStart("nav:render:" + href);
      await renderPageFromData(pageData, targetPath);
      perfEnd("nav:render:" + href);

      if (restoreScroll) {
        restoreScrollPosition(targetPath);
      } else if (hash) {
        requestAnimationFrame(() => {
          const target = document.getElementById(hash);
          if (target) {
            target.scrollIntoView({ behavior: "smooth" });
            return;
          }
          window.scrollTo(0, 0);
        });
      } else {
        window.scrollTo(0, 0);
      }

      hideNavigationProgress();
      perfEnd("nav:total:" + href);
      emitRouteTiming("total", targetPath, navigationStartedAt, {
        href,
        historyMode,
        restoreScroll,
      });
      log("SPA navigation complete");
    } catch (error) {
      hideNavigationProgress();

      if ((error as Error).name === "AbortError") {
        log("Navigation aborted");
        return;
      }

      logError("SPA navigation failed:", (error as Error).message);

      if ((error as { status?: number }).status === 404) {
        logError("Page not found:", href);
      }

      navigateDocument(href);
    } finally {
      isNavigating = false;
      currentAbortController = null;
      processPageDataPrefetchQueue();
    }
  }

  // ============================================
  // Render page from page data
  // ============================================
  async function loadPageDataComponent(
    pageData: PageDataPayload,
    path: string,
    options: { allowDocumentReload?: boolean } = {},
  ): Promise<unknown> {
    if (!pageData.isolatedClientPage) return loadComponent(path, pageData, options);

    const moduleUrl = buildPinnedRscModuleUrl(path, pageData);
    const module = await snapshotModules.importSnapshotBoundModule(
      moduleUrl,
      options.allowDocumentReload !== false,
    );
    return module.MDXLayout || module.MainLayout || module.default || module;
  }

  async function renderPageFromData(
    pageData: PageDataPayload,
    targetPath: string,
  ): Promise<void> {
    if (pageData.requiresFullDocumentNavigation) {
      throw new Error("Server layout requires full document navigation");
    }

    if (window.__veryfrontSetReleaseId) {
      window.__veryfrontSetReleaseId(pageData.releaseId || null);
    }
    if (window.__veryfrontSetReleaseAssetModules) {
      window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules || null);
    }

    perfStart("render:loadAll");
    const allPaths = getPageDataModulePaths(pageData);
    const modulesStartedAt = routeTimingNow();
    const components = await Promise.all(
      allPaths.map((path) => loadPageDataComponent(pageData, path)),
    );
    emitRouteTiming("modules", targetPath, modulesStartedAt, { count: allPaths.length });
    perfEnd("render:loadAll");

    const [PageComponent, ...rest] = components;
    // errorPath is pushed last in getPageDataModulePaths, so pop it first.
    const ErrorComponent = pageData.errorPath ? rest.pop() : null;
    const AppComponent = pageData.appPath ? rest.pop() : null;
    const LayoutComponents = rest;

    if (!PageComponent) {
      throw new Error("Failed to load page component: " + pageData.pagePath);
    }

    handoffClientRouteMetadata(
      pageData.frontmatter ?? {},
      document as RuntimeDocument & Document,
    );

    if (pageData.css) {
      const existingStyle = document.getElementById("veryfront-spa-css");
      if (existingStyle) {
        existingStyle.textContent = pageData.css;
      } else {
        const styleEl = document.createElement("style");
        const nonce = getDocumentNonce(document);
        if (nonce) styleEl.setAttribute("nonce", nonce);
        styleEl.id = "veryfront-spa-css";
        styleEl.textContent = pageData.css;
        document.head.appendChild(styleEl);
      }
      log("Injected CSS for SPA navigation", { cssLength: pageData.css.length });
    } else if (pageData.cssAction === "clear") {
      const existingStyle = document.getElementById("veryfront-spa-css");
      if (existingStyle) {
        existingStyle.remove();
        log("Cleared SPA CSS for release stylesheet navigation");
      }
    }

    // Normalize catch-all params (arrays -> joined strings) so page props and
    // page context match the server render exactly. SSR emits joined strings
    // via flattenRouteParams; without this the client would hand raw arrays to
    // props and usePageContext() after navigation (issue #2742).
    const normalizedParams = normalizeRouteParams(pageData.params);

    let tree = React.createElement(PageComponent, {
      ...pageData.props,
      params: normalizedParams,
    });

    if (pageData.layouts?.length) {
      for (let i = pageData.layouts.length - 1; i >= 0; i--) {
        const layout = pageData.layouts[i];
        const LayoutComponent = LayoutComponents[i];
        if (!LayoutComponent || !layout) continue;

        const layoutProps = pageData.layoutProps?.[layout.path] || {};
        tree = React.createElement(LayoutComponent, { ...layoutProps, children: tree });
      }
    }

    if (AppComponent) {
      tree = React.createElement(AppComponent, { children: tree });
      log("Wrapped with App component for SPA navigation");
    }

    // App-router error.tsx boundary — wraps the page so a throw during a
    // client-side navigation render is caught and error.tsx renders (matching
    // the server + initial-hydration boundary), with a working reset().
    if (ErrorComponent) {
      class AppRouterErrorBoundary extends React.Component {
        constructor(props: Record<string, unknown>) {
          super(props);
          this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error: unknown) {
          return { hasError: true, error: error };
        }
        render() {
          if (this.state.hasError) {
            return React.createElement(ErrorComponent, {
              error: this.state.error,
              reset: () => this.setState({ hasError: false, error: null }),
            });
          }
          return this.props.children;
        }
      }
      tree = React.createElement(AppRouterErrorBoundary, null, tree);
    }

    const headingsArray = pageData.headings || [];
    const pageContext = {
      slug: pageData.slug || "",
      path: pageData.pagePath || targetPath,
      params: normalizedParams,
      query: Object.fromEntries(new URLSearchParams(window.location.search)),
      frontmatter: pageData.frontmatter || {},
      data: pageData.props || {},
      headings: headingsArray,
      mdxHeadings: headingsArray,
    };

    tree = React.createElement(PageContextProvider, { pageContext, children: tree });
    tree = React.createElement(RouterProvider, { router, children: tree });

    const container = pageData.isolatedClientPage
      ? document.getElementById("veryfront-page-island")
      : document.getElementById("root");

    if (!hydrationCompleted && !hydrationFailed) {
      log("Waiting for hydration to complete before SPA render...");
      try {
        await Promise.race([
          hydrationPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Hydration timeout")), 10000)
          ),
        ]);
      } catch (waitError) {
        log("Hydration wait failed:", (waitError as Error).message);
      }
    }

    if (container?.__reactRoot) {
      perfStart("render:reactRender");
      container.__reactRoot.render(tree);
      perfEnd("render:reactRender");
      log("Page re-rendered via SPA");
      scheduleRoutePrefetchRefresh();
      return;
    }

    if (hydrationFailed) {
      throw new Error(
        "React root not found - hydration failed, falling back to full page navigation",
      );
    }

    throw new Error("React root not found");
  }

  // ============================================
  // Prefetching on hover
  // ============================================
  let prefetchTimeout: number | null = null;
  let currentHoverLink: RuntimeElement | null = null;
  let routePrefetchRefreshPending = false;
  let viewportPrefetchObserver: IntersectionObserver | null = null;
  const observedPrefetchLinks = new WeakSet<object>();
  const prefetchedPaths = new Set<string>();
  const inFlightPrefetches = new Set<string>();
  const queuedPrefetchPaths = new Set<string>();
  const pageDataPrefetchQueue: string[] = [];
  const activePageDataPrefetchControllers = new Map<string, AbortController>();

  function cancelScheduledPrefetch(): void {
    if (prefetchTimeout) {
      clearTimeout(prefetchTimeout);
      prefetchTimeout = null;
    }

    currentHoverLink = null;
  }

  function getPageDataModulePaths(pageData: PageDataPayload): string[] {
    const layoutPaths = (pageData.layouts || []).map((l) => l.path).filter(Boolean);
    const allPaths = [pageData.pagePath, ...layoutPaths].filter(Boolean) as string[];

    if (pageData.appPath) allPaths.push(pageData.appPath);
    if (pageData.errorPath) allPaths.push(pageData.errorPath);

    return allPaths;
  }

  function getCurrentRouteHref(): string {
    return window.location.pathname + window.location.search;
  }

  function getInternalRouteHrefFromLink(link: RuntimeElement | null): string | null {
    if (
      !link ||
      link.target === "_blank" ||
      link.hasAttribute("download") ||
      link.getAttribute("data-prefetch") === "false"
    ) {
      return null;
    }

    const href = link.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("//") || !href.startsWith("/")) {
      return null;
    }

    try {
      const url = new URL(href, window.location.origin);
      if (url.origin !== window.location.origin) return null;

      const routeHref = url.pathname + url.search;
      return routeHref === getCurrentRouteHref() ? null : routeHref;
    } catch (_) {
      return null;
    }
  }

  function getEligiblePrefetchLinks(
    limit: number,
  ): Array<{ link: RuntimeElement; href: string }> {
    const links: Array<{ link: RuntimeElement; href: string }> = [];
    const seenHrefs = new Set<string>();

    for (const link of document.querySelectorAll("a[href]")) {
      const href = getInternalRouteHrefFromLink(link);
      if (!href || seenHrefs.has(href)) continue;

      seenHrefs.add(href);
      links.push({ link, href });

      if (links.length >= limit) break;
    }

    return links;
  }

  async function preloadModulesForPageData(
    pageData: PageDataPayload,
    path: string,
  ): Promise<void> {
    if (!pageData || pageData.requiresFullDocumentNavigation) return;
    if (pageData.releaseId && window.__veryfrontSetReleaseId) {
      window.__veryfrontSetReleaseId(pageData.releaseId);
    }
    if (pageData.releaseAssetModules && window.__veryfrontSetReleaseAssetModules) {
      window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules);
    }

    const modulePaths = getPageDataModulePaths(pageData);
    if (modulePaths.length === 0) return;

    try {
      await Promise.all(
        modulePaths.map((modulePath) =>
          loadPageDataComponent(pageData, modulePath, { allowDocumentReload: false })
        ),
      );
    } catch (error) {
      if (isDependencySnapshotConflict(error)) {
        const cacheIdentity = pageDataCacheIdentity(path);
        pageDataCache.delete(cacheIdentity);
        backgroundRefreshTimestamps.delete(cacheIdentity);
        prefetchedPaths.delete(path);
        throw error;
      }
      logBackgroundFetchFailure("Module prefetch", path, error);
    }
  }

  function removeQueuedPrefetch(path: string): void {
    queuedPrefetchPaths.delete(path);
    for (let i = pageDataPrefetchQueue.length - 1; i >= 0; i--) {
      if (pageDataPrefetchQueue[i] === path) pageDataPrefetchQueue.splice(i, 1);
    }
  }

  function abortActiveSpeculativePrefetches(): void {
    for (const controller of activePageDataPrefetchControllers.values()) {
      controller.abort();
    }
  }

  function processPageDataPrefetchQueue(): void {
    if (isNavigating) return;

    while (
      activePageDataPrefetchControllers.size < PAGE_DATA_PREFETCH_CONCURRENCY &&
      pageDataPrefetchQueue.length > 0
    ) {
      const href = pageDataPrefetchQueue.shift() as string;
      queuedPrefetchPaths.delete(href);

      if (prefetchedPaths.has(href) || inFlightPrefetches.has(href) || getCachedPageData(href)) {
        continue;
      }

      if (prefetchedPaths.size >= MAX_PREFETCH_PATHS) {
        const oldest = prefetchedPaths.values().next().value;
        if (oldest) prefetchedPaths.delete(oldest);
      }

      const controller = new AbortController();
      prefetchedPaths.add(href);
      inFlightPrefetches.add(href);
      activePageDataPrefetchControllers.set(href, controller);

      fetchPageDataForPrefetch(href, controller.signal)
        .catch((error) => {
          prefetchedPaths.delete(href);
          if (isDependencySnapshotConflict(error)) {
            logBackgroundFetchFailure("Module prefetch", href, error);
          }
        })
        .finally(() => {
          inFlightPrefetches.delete(href);
          activePageDataPrefetchControllers.delete(href);
          processPageDataPrefetchQueue();
        });
    }
  }

  function prefetchPage(href: string): void {
    if (isNavigating) return;
    if (
      prefetchedPaths.has(href) || inFlightPrefetches.has(href) || queuedPrefetchPaths.has(href)
    ) return;

    const cachedPageData = getCachedPageData(href);
    if (cachedPageData) {
      preloadModulesForPageData(cachedPageData, href).catch((error) => {
        logBackgroundFetchFailure("Module prefetch", href, error);
      });
      return;
    }

    queuedPrefetchPaths.add(href);
    pageDataPrefetchQueue.push(href);
    processPageDataPrefetchQueue();
  }

  function prefetchEligibleRouteLinks(limit: number): void {
    for (const { href } of getEligiblePrefetchLinks(limit)) {
      prefetchPage(href);
    }
  }

  function ensureViewportPrefetchObserver(): IntersectionObserver | null {
    if (viewportPrefetchObserver || typeof IntersectionObserver !== "function") {
      return viewportPrefetchObserver;
    }

    viewportPrefetchObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;

        viewportPrefetchObserver?.unobserve(entry.target);
        const href = getInternalRouteHrefFromLink(
          entry.target as Element & RuntimeElement,
        );
        if (href) prefetchPage(href);
      }
    }, { rootMargin: VIEWPORT_PREFETCH_ROOT_MARGIN });

    return viewportPrefetchObserver;
  }

  function observeViewportPrefetchLinks(): void {
    const observer = ensureViewportPrefetchObserver();
    if (!observer) return;

    for (const { link } of getEligiblePrefetchLinks(VIEWPORT_PREFETCH_MAX_LINKS)) {
      if (observedPrefetchLinks.has(link)) continue;

      observedPrefetchLinks.add(link);
      observer.observe(link as RuntimeElement & Element);
    }
  }

  function runRoutePrefetchRefresh(): void {
    routePrefetchRefreshPending = false;
    prefetchEligibleRouteLinks(IDLE_PREFETCH_MAX_LINKS);
    observeViewportPrefetchLinks();
  }

  function scheduleRoutePrefetchRefresh(): void {
    if (routePrefetchRefreshPending) return;

    routePrefetchRefreshPending = true;
    setTimeout(() => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(runRoutePrefetchRefresh, { timeout: IDLE_PREFETCH_DELAY_MS });
        return;
      }

      runRoutePrefetchRefresh();
    }, IDLE_PREFETCH_DELAY_MS);
  }

  // ============================================
  // Router object
  // ============================================
  const router: ClientRouter = {
    domain: window.location.origin,
    path: window.location.pathname,
    push: (path: string) => {
      void navigateSPA(path, "push");
    },
    replace: (path: string) => {
      void navigateSPA(path, "replace");
    },
    back: () => {
      window.history.back();
    },
    forward: () => {
      window.history.forward();
    },
    prefetch: (path: string) => {
      prefetchPage(path);
    },
    pathname: window.location.pathname,
    query: Object.fromEntries(new URLSearchParams(window.location.search)),
    // Seed route params from the hydration data (issue #2741). Catch-all
    // segments arrive as arrays and are joined so no path info is lost.
    params: normalizeRouteParams(deps.initialHydrationData.params || {}),
    isPreview: false,
    isMounted: true,
    navigate: (path: string) => navigateSPA(path, "push"),
    reload: () => window.location.reload(),
  };

  window.__veryfrontRouter = router;

  // Route useRouter().push/replace/navigate (from veryfront/router) through the
  // same SPA navigator that intercepts <Link> clicks. Without this the shared
  // navigation store has no navigator registered and its navigate() falls back
  // to a full-page location.assign (finding #7: push() full-reloads).
  if (deps.navigationStoreUsesRegistryFallback) {
    log("Router runtime does not export getNavigationStore; using shared v1 registry fallback");
  }
  if (typeof deps.getNavigationStore === "function") {
    deps.getNavigationStore().setNavigator((href, options) => {
      const mode = options && options.history;
      const historyMode: HistoryMode = mode === "replace"
        ? "replace"
        : mode === "none"
        ? "none"
        : "push";
      return navigateSPA(href, historyMode);
    });
  }

  // ============================================
  // Event handlers
  // ============================================
  window.addEventListener("popstate", async (e: RuntimeEvent) => {
    const path = window.location.pathname;
    log("Popstate:", path);

    saveScrollPosition(currentPath);

    if (!e.state?.pageData) {
      await navigateSPA(path, "none", true);
      return;
    }

    showNavigationProgress();
    try {
      // Update the router snapshot before rendering so RouterProvider reads
      // this route's params, not the previous route's (issue #2741).
      currentPath = path;
      router.pathname = path;
      router.query = Object.fromEntries(new URLSearchParams(window.location.search));
      router.params = normalizeRouteParams(e.state.pageData.params);

      await renderPageFromData(e.state.pageData, path);

      restoreScrollPosition(path);
      hideNavigationProgress();
    } catch (error) {
      hideNavigationProgress();
      logError("Popstate render failed:", (error as Error).message);
      window.location.reload();
    }
  });

  document.addEventListener("click", (e: RuntimeEvent) => {
    const link = e.target?.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) {
      const target = document.getElementById(href.slice(1));
      if (!target) return;

      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth" });
      window.history.pushState(null, "", href);
      return;
    }

    if (
      link.target === "_blank" ||
      link.hasAttribute("download") ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      !href.startsWith("/") ||
      href.startsWith("//")
    ) {
      return;
    }

    e.preventDefault();
    cancelScheduledPrefetch();
    void navigateSPA(href, "push");
  });

  document.addEventListener(
    "mouseenter",
    (e: RuntimeEvent) => {
      if (!e.target || typeof e.target.closest !== "function") return;
      const link = e.target.closest("a[href]");
      if (!link) return;

      const href = getInternalRouteHrefFromLink(link);
      if (!href) return;

      if (currentHoverLink === link) return;

      if (prefetchTimeout) {
        clearTimeout(prefetchTimeout);
        prefetchTimeout = null;
      }

      currentHoverLink = link;
      prefetchTimeout = setTimeout(() => {
        prefetchPage(href);
        prefetchTimeout = null;
      }, PREFETCH_DELAY_MS);
    },
    true,
  );

  document.addEventListener(
    "mouseleave",
    (e: RuntimeEvent) => {
      if (!e.target || typeof e.target.closest !== "function") return;

      const relatedTarget = e.relatedTarget;
      if (currentHoverLink && relatedTarget && currentHoverLink.contains(relatedTarget)) return;

      cancelScheduledPrefetch();
    },
    true,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRoutePrefetchRefresh, { once: true });
  } else {
    scheduleRoutePrefetchRefresh();
  }

  // ============================================
  // Router hooks
  // ============================================
  window.useRouter = () => {
    try {
      return env.useRouterFromModule();
    } catch (_) {
      /* expected: useRouterFromModule may not be available, fall back to global router */
      return window.__veryfrontRouter;
    }
  };

  return {
    router,
    navigateSPA,
    renderPageFromData,
    prefetchPage,
    signalHydrationComplete,
    signalHydrationFailed,
  };
}
