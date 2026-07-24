import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRouterScript } from "./router.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

describe("hydration-script-builder/templates/router", () => {
  describe("getRouterScript", () => {
    it("should return a non-empty string", () => {
      const result = getRouterScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should generate parseable browser JavaScript", () => {
      new Function(getRouterScript());
    });

    it("should define MODULE_SERVER_URL from window origin", () => {
      assertIncludes(getRouterScript(), "window.location.origin + '/_vf_modules'");
    });

    it("should define hydration state tracking", () => {
      const result = getRouterScript();
      for (
        const token of [
          "hydrationResolve",
          "hydrationReject",
          "hydrationPromise",
          "hydrationCompleted",
          "hydrationFailed",
        ]
      ) {
        assertIncludes(result, token);
      }
    });

    it("should expose hydration complete callback on window", () => {
      assertIncludes(getRouterScript(), "window.__veryfrontHydrationComplete");
    });

    it("should expose hydration failed callback on window", () => {
      assertIncludes(getRouterScript(), "window.__veryfrontHydrationFailed");
    });

    it("should define DEBUG flag from URL params or window property", () => {
      const result = getRouterScript();
      assertIncludes(result, "window.__VERYFRONT_DEBUG__");
      assertIncludes(result, "vf_debug");
    });

    it("should define FETCH_TIMEOUT_MS constant", () => {
      assertIncludes(getRouterScript(), "FETCH_TIMEOUT_MS = 10000");
    });

    it("should define MAX_RETRIES constant", () => {
      assertIncludes(getRouterScript(), "MAX_RETRIES = 2");
    });

    it("should define MAX_CACHE_SIZE constant", () => {
      assertIncludes(getRouterScript(), "MAX_CACHE_SIZE = 50");
    });

    it("should define CACHE_TTL_MS constant (5 minutes)", () => {
      assertIncludes(getRouterScript(), "CACHE_TTL_MS = 5 * 60 * 1000");
    });

    it("should define debug logging functions", () => {
      const result = getRouterScript();
      assertIncludes(result, "const log = DEBUG");
      assertIncludes(result, "const logError = console.error");
    });

    it("should log non-blocking background page-data fetch failures", () => {
      const result = getRouterScript();
      assertIncludes(result, "function logBackgroundFetchFailure(reason, path, error)");
      assertIncludes(result, "function isAbortError(error)");
      assertIncludes(result, "logBackgroundFetchFailure('Stale page data refresh', path, error)");
      assertIncludes(result, "if (!isAbortError(error)) {");
      assertIncludes(result, "logBackgroundFetchFailure('Page data prefetch', path, error)");
    });

    it("should define version tracking for cache invalidation", () => {
      const result = getRouterScript();
      assertIncludes(result, "function checkVersionMismatch(newVersion)");
      assertIncludes(result, "clientBuildVersion");
    });

    it("should check serverStart in version mismatch", () => {
      assertIncludes(getRouterScript(), "newVersion.serverStart");
    });

    it("should check framework version in version mismatch", () => {
      assertIncludes(getRouterScript(), "newVersion.framework");
    });

    it("should check projectUpdated in version mismatch", () => {
      assertIncludes(getRouterScript(), "newVersion.projectUpdated");
    });

    it("should define LRU page data cache with TTL", () => {
      const result = getRouterScript();
      assertIncludes(result, "function getCachedPageData(path)");
      assertIncludes(result, "function setCachedPageData(path, data)");
    });

    it("should dedupe and throttle background page-data refreshes", () => {
      const result = getRouterScript();
      assertIncludes(result, "BACKGROUND_REFRESH_INTERVAL_MS = 30 * 1000");
      assertIncludes(result, "const pendingPageDataFetches = new Map()");
      assertIncludes(result, "function startPageDataFetch(path, signal, options = {})");
      assertIncludes(result, "function refreshPageDataInBackground(path)");
      assertIncludes(result, "pendingPageDataFetches.set(path, request)");
      assertIncludes(result, "refreshPageDataInBackground(path)");
    });

    it("should reuse pending page-data fetches for first-hit navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "log('Reusing pending page data fetch for navigation:', path)");
      assertIncludes(result, "return handlePageDataVersionMismatch(path, data)");
      assertIncludes(
        result,
        "emitRouteTiming('page-data', path, startedAt, { source: 'deduped' });",
      );
    });

    it("should emit fresh page-data timing only for navigation fetches", () => {
      const result = getRouterScript();
      assertIncludes(result, "recordRouteTiming = false");
      assertIncludes(result, "if (recordRouteTiming) {");
      assertIncludes(result, "startPageDataFetch(path, null)");
      assertIncludes(result, "recordRouteTiming: true");
    });

    it("should register first-hit navigation page-data fetches for prefetch dedupe", () => {
      const result = getRouterScript();
      assertIncludes(result, "return startPageDataFetch(path, signal, {");
      assertIncludes(result, "timingSource: 'network'");
    });

    it("should cancel hover prefetch before click navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "function cancelScheduledPrefetch()");
      assertIncludes(result, "cancelScheduledPrefetch();\n      void navigateSPA(href, 'push');");
    });

    it("should skip page-data prefetches while navigation is active", () => {
      const result = getRouterScript();
      assertIncludes(result, "let isNavigating = false;");
      assertIncludes(result, "function prefetchPage(href) {\n      if (isNavigating) return;");
    });

    it("should emit route transition timing events", () => {
      const result = getRouterScript();
      assertIncludes(result, "function emitRouteTiming(phase, path, startedAt, detail = {})");
      assertIncludes(result, "window.__veryfrontRouteTimings");
      assertIncludes(result, "veryfront:route-timing");
      assertIncludes(result, "emitRouteTiming('total', targetPath, navigationStartedAt");
    });

    it("should capture bounded Server-Timing details for page-data network timing", () => {
      const result = getRouterScript();
      assertIncludes(result, "MAX_SERVER_TIMING_LENGTH = 1024");
      assertIncludes(result, "function sanitizeServerTimingHeader(value)");
      assertIncludes(result, "replace(/[^\\x20-\\x7E]/g, ' ')");
      assertIncludes(result, "sanitized.slice(0, MAX_SERVER_TIMING_LENGTH)");
      assertIncludes(result, "response.headers?.get('server-timing')");
      assertIncludes(result, "function parseServerTimingMetrics(value)");
      assertIncludes(result, "segment.split('=')");
      assertIncludes(result, "if (!Number.isFinite(duration) || duration < 0) continue;");
      assertIncludes(result, "metrics.push(name + ';dur='");
      assertIncludes(result, "detail.serverTiming = serverTiming");
      assertIncludes(result, "detail.serverTimingMetrics = serverTimingMetrics");
    });

    it("should capture best-effort browser resource timing for page-data network timing", () => {
      const result = getRouterScript();
      assertIncludes(result, "function getPageDataResourceTiming(endpoint, fetchStartedAt)");
      assertIncludes(result, "performance.getEntriesByName(href, 'resource')");
      assertIncludes(result, "function extractResourceTiming(entry)");
      assertIncludes(result, "'responseStart'");
      assertIncludes(result, "'responseEnd'");
      assertIncludes(result, "'transferSize'");
      assertIncludes(result, "value >= 0");
      assertIncludes(result, "Number.isFinite(entry.responseEnd)");
      assertIncludes(result, "entry.responseEnd + 1 >= fetchStartedAt");
      assertIncludes(result, "return null;");
      assertIncludes(result, "detail.resourceTiming = resourceTiming");
    });

    it("should enrich only page-data network timing records", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "function buildPageDataTimingDetail(response, endpoint, fetchStartedAt, source)",
      );
      assertIncludes(
        result,
        "buildPageDataTimingDetail(response, endpoint, startedAt, timingSource)",
      );
      assertIncludes(result, "emitRouteTiming('page-data', path, startedAt, { source: 'cache' });");
      assertIncludes(
        result,
        "emitRouteTiming('page-data', path, startedAt, { source: 'deduped' });",
      );
    });

    it("should define scroll position memory", () => {
      const result = getRouterScript();
      assertIncludes(result, "function saveScrollPosition(path)");
      assertIncludes(result, "function restoreScrollPosition(path)");
      assertIncludes(result, "MAX_SCROLL_POSITIONS = 100");
    });

    it("should define loading progress indicator", () => {
      const result = getRouterScript();
      assertIncludes(result, "function showNavigationProgress()");
      assertIncludes(result, "function hideNavigationProgress()");
      assertIncludes(result, "vf-nav-progress");
    });

    it("should define fetchWithRetry with timeout and abort support", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function fetchWithRetry(url, options, maxRetries");
      assertIncludes(result, "AbortController");
    });

    it("should implement exponential backoff in retry", () => {
      assertIncludes(getRouterScript(), "Math.pow(2, attempt) * 500");
    });

    it("should define navigateSPA function", () => {
      assertIncludes(getRouterScript(), "async function navigateSPA(href, historyMode");
    });

    it("should define renderPageFromData function", () => {
      assertIncludes(getRouterScript(), "async function renderPageFromData(pageData, targetPath)");
    });

    it("should load isolated page-island modules through the hardened RSC endpoint", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function loadPageDataComponent(pageData, path)");
      assertIncludes(
        result,
        "const moduleUrl = '/_veryfront/rsc/module?rel=' + encodeURIComponent(path);",
      );
      assertIncludes(result, "const module = await import(moduleUrl);");
      assertIncludes(
        result,
        "allPaths.map((path) => loadPageDataComponent(pageData, path))",
      );
    });

    it("should fall back to document navigation for server-layout page targets", () => {
      const result = getRouterScript();
      assertIncludes(result, "if (pageData.requiresFullDocumentNavigation) {");
      assertIncludes(result, "throw new Error('Server layout requires full document navigation');");
      assertIncludes(result, "window.location.href = href;");
    });

    it("should install release asset modules from SPA page data before loading components", () => {
      const result = getRouterScript();
      assertIncludes(result, "pageData.releaseAssetModules");
      assertIncludes(result, "__veryfrontSetReleaseAssetModules");
    });

    it("should install release id from SPA page data before loading components", () => {
      const result = getRouterScript();
      assertIncludes(result, "pageData.releaseId");
      assertIncludes(result, "__veryfrontSetReleaseId");
    });

    it("should clear release asset modules when SPA page data has no map", () => {
      assertIncludes(
        getRouterScript(),
        "window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules || null);",
      );
    });

    it("should define prefetching on hover", () => {
      const result = getRouterScript();
      assertIncludes(result, "function prefetchPage(href)");
      assertIncludes(result, "function preloadModulesForPageData(pageData, path)");
      assertIncludes(result, "loadPageDataComponent(pageData, modulePath)");
      assertIncludes(result, "PREFETCH_DELAY_MS");
      assertIncludes(result, "MAX_PREFETCH_PATHS = 100");
    });

    it("should prefetch isolated modules securely and skip document-navigation targets", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function loadPageDataComponent(pageData, path)");
      assertIncludes(
        result,
        "if (!pageData || pageData.requiresFullDocumentNavigation) return;",
      );
      assertIncludes(
        result,
        "modulePaths.map((modulePath) => loadPageDataComponent(pageData, modulePath))",
      );
    });

    it("should schedule capped idle and viewport prefetch for eligible internal links", () => {
      const result = getRouterScript();
      assertIncludes(result, "IDLE_PREFETCH_DELAY_MS = 1200");
      assertIncludes(result, "IDLE_PREFETCH_MAX_LINKS = 4");
      assertIncludes(result, "VIEWPORT_PREFETCH_MAX_LINKS = 8");
      assertIncludes(result, "PAGE_DATA_PREFETCH_CONCURRENCY = 2");
      assertIncludes(result, "VIEWPORT_PREFETCH_ROOT_MARGIN = '200px'");
      assertIncludes(result, "link.getAttribute('data-prefetch') === 'false'");
      assertIncludes(result, "document.querySelectorAll('a[href]')");
      assertIncludes(result, "function getInternalRouteHrefFromLink(link)");
      assertIncludes(result, "function getEligiblePrefetchLinks(limit)");
      assertIncludes(result, "function prefetchEligibleRouteLinks(limit)");
      assertIncludes(result, "function observeViewportPrefetchLinks()");
      assertIncludes(result, "IntersectionObserver");
      assertIncludes(result, "requestIdleCallback(runRoutePrefetchRefresh");
    });

    it("should refresh eligible prefetch links after load and SPA renders", () => {
      const result = getRouterScript();
      assertIncludes(result, "scheduleRoutePrefetchRefresh();\n        return;");
      assertIncludes(
        result,
        "document.addEventListener('DOMContentLoaded', scheduleRoutePrefetchRefresh",
      );
      assertIncludes(
        result,
        "scheduleRoutePrefetchRefresh();\n    }\n\n    // ============================================",
      );
    });

    it("should define router object with standard methods", () => {
      const result = getRouterScript();
      for (
        const token of [
          "const router = {",
          "push:",
          "replace:",
          "back:",
          "forward:",
          "prefetch:",
          "navigate:",
          "reload:",
        ]
      ) {
        assertIncludes(result, token);
      }
    });

    it("should expose router on window", () => {
      assertIncludes(getRouterScript(), "window.__veryfrontRouter = router");
    });

    it("should normalize route params joining catch-all segments", () => {
      const result = getRouterScript();
      assertIncludes(result, "function normalizeRouteParams(raw)");
      assertIncludes(result, "Array.isArray(value) ? value.join('/') : value");
    });

    it("should refresh router params during SPA and popstate navigation", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);",
      );
      assertIncludes(
        result,
        "window.__veryfrontRouter.params = normalizeRouteParams(e.state.pageData.params);",
      );
    });

    it("should handle popstate events for browser back/forward", () => {
      assertIncludes(getRouterScript(), "addEventListener('popstate'");
    });

    it("should intercept link clicks for SPA navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "addEventListener('click'");
      assertIncludes(result, "closest('a[href]')");
    });

    it("should skip external links and modifier key clicks", () => {
      const result = getRouterScript();
      for (const token of ["target === '_blank'", "e.metaKey", "e.ctrlKey", "e.shiftKey"]) {
        assertIncludes(result, token);
      }
    });

    it("should handle hash-only links", () => {
      const result = getRouterScript();
      assertIncludes(result, "href.startsWith('#')");
      assertIncludes(result, "scrollIntoView");
    });

    it("should set up mouseenter for prefetch with debounce", () => {
      assertIncludes(getRouterScript(), "addEventListener(\n      'mouseenter'");
    });

    it("should set up mouseleave to cancel prefetch", () => {
      assertIncludes(getRouterScript(), "addEventListener(\n      'mouseleave'");
    });

    it("should expose useRouter on window", () => {
      assertIncludes(getRouterScript(), "window.useRouter");
    });

    it("should set aria-busy during navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "setAttribute('aria-busy', 'true')");
      assertIncludes(result, "removeAttribute('aria-busy')");
    });

    it("should inject CSS for SPA navigation in renderPageFromData", () => {
      const result = getRouterScript();
      assertIncludes(result, "veryfront-spa-css");
      assertIncludes(result, "function getDocumentNonce()");
      assertIncludes(result, "styleEl.setAttribute('nonce', nonce)");
    });

    it("should clear stale SPA CSS when page data marks release CSS authoritative", () => {
      const result = getRouterScript();
      assertIncludes(result, "pageData.cssAction === 'clear'");
      assertIncludes(result, "existingStyle.remove()");
      assertIncludes(result, "Cleared SPA CSS for release stylesheet navigation");
    });

    it("should update document title during SPA navigation", () => {
      assertIncludes(getRouterScript(), "document.title = pageData.frontmatter.title");
    });
  });

  // Executable coverage: evaluate the generated browser runtime in a stubbed
  // DOM so a future edit can't keep the string tokens while breaking the actual
  // hydration-data parsing, param normalization, or SPA/popstate param updates.
  describe("generated router runtime (executable)", () => {
    interface RuntimeLocation {
      origin: string;
      pathname: string;
      search: string;
      readonly href: string;
    }
    interface RuntimeRouter {
      params: Record<string, string>;
      pathname: string;
      query: Record<string, string>;
      navigate(path: string): Promise<void>;
      push(path: string): void;
      prefetch(path: string): void;
    }
    interface RuntimeFetchCall {
      url: string;
      options: { headers?: Record<string, string>; signal?: AbortSignal };
    }
    interface RuntimeWindow {
      location: RuntimeLocation;
      history: { pushState(): void; back(): void; forward(): void };
      addEventListener(type: string, fn: (e: unknown) => void): void;
      dispatchEvent(): boolean;
      scrollTo(): void;
      scrollY: number;
      __VERYFRONT_DEBUG__?: boolean;
      __veryfrontRouter?: RuntimeRouter;
      __veryfrontHydrationComplete?: () => void;
    }
    interface RuntimeHandle {
      router: RuntimeRouter;
      navigateSPA: (href: string, pushState?: boolean, restoreScroll?: boolean) => Promise<void>;
      win: RuntimeWindow;
      listeners: Record<string, Array<(e: unknown) => void>>;
      setNextPageData: (data: unknown) => void;
      fetchCalls: RuntimeFetchCall[];
      // The router.params snapshot captured the moment renderPageFromData built
      // the RouterProvider element — i.e. what the new page renders with. This is
      // what the ordering bug (mutating params after render) would get wrong.
      getRenderedParams: () => Record<string, string> | null;
      // The `params` prop handed to the page component during render — must be
      // normalized (joined) so it matches the server render.
      getRenderedPageParams: () => Record<string, string> | null;
    }

    function evaluateRouterRuntime(
      opts: {
        pathname?: string;
        search?: string;
        hydrationParams?: Record<string, string | string[]>;
        fetchImpl?: (
          url: string,
          options: { headers?: Record<string, string>; signal?: AbortSignal },
        ) => Promise<unknown>;
        debug?: boolean;
      } = {},
    ): RuntimeHandle {
      const hydrationJson = JSON.stringify({ params: opts.hydrationParams ?? {} });
      const listeners: Record<string, Array<(e: unknown) => void>> = {};
      const addEventListener = (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      };

      const makeEl = () => ({
        style: {} as Record<string, unknown>,
        id: "",
        textContent: "",
        setAttribute() {},
        getAttribute() {
          return null;
        },
        prepend() {},
        remove() {},
        appendChild() {},
      });

      const rootEl = { __reactRoot: { render() {} } };
      const doc = {
        readyState: "complete",
        body: { prepend() {}, setAttribute() {}, removeAttribute() {}, appendChild() {} },
        head: { appendChild() {} },
        createElement: () => makeEl(),
        querySelector: () => null,
        querySelectorAll: () => [] as unknown[],
        getElementById: (id: string) => {
          if (id === "veryfront-hydration-data") return { textContent: hydrationJson };
          if (id === "root") return rootEl;
          return null;
        },
        addEventListener,
      };

      const win: RuntimeWindow = {
        location: {
          origin: "https://veryfront.test",
          pathname: opts.pathname ?? "/",
          search: opts.search ?? "",
          get href() {
            return "https://veryfront.test" + this.pathname + this.search;
          },
        },
        history: { pushState() {}, back() {}, forward() {} },
        addEventListener,
        dispatchEvent() {
          return true;
        },
        scrollTo() {},
        scrollY: 0,
        __VERYFRONT_DEBUG__: opts.debug,
      };

      let nextPageData: unknown = { pagePath: "page", params: {} };
      const fetchCalls: RuntimeFetchCall[] = [];
      const fetchStub = (
        url: string,
        options: { headers?: Record<string, string>; signal?: AbortSignal },
      ) => {
        fetchCalls.push({ url, options });
        if (opts.fetchImpl) return opts.fetchImpl(url, options);

        return Promise.resolve({
          ok: true,
          status: 200,
          url: "/_veryfront/page-data/page.json",
          headers: { get: () => null },
          json: () => Promise.resolve(nextPageData),
        });
      };

      const RouterProvider = () => ({});
      const PageContextProvider = () => ({});
      // Capture params exactly when the generated render builds elements, so the
      // test reflects what the new page renders with (not the value the router
      // settles on afterwards). renderedRouterParams = what RouterProvider sees;
      // renderedPageParams = what the page component receives as its `params`
      // prop (must be normalized so it matches the server render, issue #2742).
      let renderedRouterParams: Record<string, string> | null = null;
      let renderedPageParams: Record<string, string> | null = null;
      const React = {
        createElement: (
          type: unknown,
          props?: { router?: RuntimeRouter; params?: Record<string, string> },
        ) => {
          if (type === RouterProvider && props?.router) {
            renderedRouterParams = { ...props.router.params };
          } else if (props && "params" in props && renderedPageParams === null) {
            renderedPageParams = { ...(props.params ?? {}) };
          }
          return {};
        },
      };
      const loadComponent = () => Promise.resolve(() => null);

      const factory = new Function(
        "window",
        "document",
        "fetch",
        "React",
        "RouterProvider",
        "PageContextProvider",
        "loadComponent",
        "setTimeout",
        "clearTimeout",
        "getNavigationStore",
        getRouterScript() + "\nreturn { router, navigateSPA };",
      );

      const handle = factory(
        win,
        doc,
        fetchStub,
        React,
        RouterProvider,
        PageContextProvider,
        loadComponent,
        () => 0,
        () => {},
        () => ({ setNavigator() {} }),
      ) as { router: RuntimeRouter; navigateSPA: RuntimeHandle["navigateSPA"] };

      return {
        router: handle.router,
        navigateSPA: handle.navigateSPA,
        win,
        listeners,
        setNextPageData: (data: unknown) => {
          nextPageData = data;
        },
        fetchCalls,
        getRenderedParams: () => renderedRouterParams,
        getRenderedPageParams: () => renderedPageParams,
      };
    }

    function pageDataResponse(path = "page"): unknown {
      return {
        ok: true,
        status: 200,
        url: "/_veryfront/page-data/" + path + ".json",
        headers: { get: () => null },
        json: () => Promise.resolve({ pagePath: path, params: {} }),
      };
    }

    function flushMicrotasks(): Promise<void> {
      return Promise.resolve().then(() => {});
    }

    async function flushUntil(check: () => boolean): Promise<void> {
      for (let i = 0; i < 10; i++) {
        if (check()) return;
        await flushMicrotasks();
      }
    }

    it("seeds router params from hydration data, joining catch-all segments", () => {
      const { router } = evaluateRouterRuntime({
        pathname: "/docs/guides/intro",
        hydrationParams: { slug: ["guides", "intro"], lang: "en" },
      });
      assertEquals(router.params, { slug: "guides/intro", lang: "en" });
    });

    it("replaces stale params with new page data on SPA navigation", async () => {
      const runtime = evaluateRouterRuntime({
        pathname: "/posts/42",
        hydrationParams: { id: "42" },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      runtime.setNextPageData({ pagePath: "page", params: { id: "99" } });
      runtime.win.location.pathname = "/posts/99";
      await runtime.navigateSPA("/posts/99", true);

      assertEquals(runtime.router.params, { id: "99" });
      assertEquals(runtime.router.pathname, "/posts/99");
      // The new page must render with the fresh params — not the previous
      // route's — which only holds if params are updated before render.
      assertEquals(runtime.getRenderedParams(), { id: "99" });
    });

    it("normalizes catch-all params for both router and page props on SPA nav", () => {
      const runtime = evaluateRouterRuntime({ pathname: "/", hydrationParams: {} });
      runtime.win.__veryfrontHydrationComplete?.();

      // Page data carries a raw catch-all array, as route matching produces it.
      runtime.setNextPageData({ pagePath: "page", params: { slug: ["guides", "intro"] } });
      return runtime.navigateSPA("/docs/guides/intro", true).then(() => {
        // Both the router snapshot and the page component's `params` prop must
        // be joined strings so client and server render identically (#2742).
        assertEquals(runtime.router.params, { slug: "guides/intro" });
        assertEquals(runtime.getRenderedParams(), { slug: "guides/intro" });
        assertEquals(runtime.getRenderedPageParams(), { slug: "guides/intro" });
      });
    });

    it("clears params when navigating to a static route", async () => {
      const runtime = evaluateRouterRuntime({
        pathname: "/posts/42",
        hydrationParams: { id: "42" },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      runtime.setNextPageData({ pagePath: "page", params: {} });
      await runtime.navigateSPA("/about", true);

      assertEquals(runtime.router.params, {});
      assertEquals(runtime.getRenderedParams(), {});
    });

    it("refreshes params from history state on popstate navigation", async () => {
      const runtime = evaluateRouterRuntime({
        pathname: "/posts/42",
        hydrationParams: { id: "42" },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      runtime.win.location.pathname = "/posts/7";
      const popstate = runtime.listeners.popstate?.[0];
      if (!popstate) throw new Error("popstate handler was not registered");
      await popstate({ state: { pageData: { pagePath: "page", params: { id: "7" } } } });

      assertEquals(runtime.router.params, { id: "7" });
      assertEquals(runtime.getRenderedParams(), { id: "7" });
    });

    it("limits generated page-data prefetches to two active requests", async () => {
      const pendingResolvers: Array<(value: unknown) => void> = [];
      const runtime = evaluateRouterRuntime({
        fetchImpl: () =>
          new Promise((resolve) => {
            pendingResolvers.push(resolve);
          }),
      });

      runtime.router.prefetch("/a");
      runtime.router.prefetch("/b");
      runtime.router.prefetch("/c");
      runtime.router.prefetch("/d");

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/a.json",
        "/_veryfront/page-data/b.json",
      ]);

      const resolveFirst = pendingResolvers[0];
      if (!resolveFirst) throw new Error("first prefetch did not start");
      resolveFirst(pageDataResponse("a"));
      await flushUntil(() => runtime.fetchCalls.length === 3);

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/a.json",
        "/_veryfront/page-data/b.json",
        "/_veryfront/page-data/c.json",
      ]);
    });

    it("marks speculative page-data prefetches and does not retry them", async () => {
      const runtime = evaluateRouterRuntime({
        fetchImpl: () =>
          Promise.resolve({
            ok: false,
            status: 500,
            url: "/_veryfront/page-data/fail.json",
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          }),
      });

      runtime.router.prefetch("/fail");
      await flushMicrotasks();
      await flushMicrotasks();

      assertEquals(runtime.fetchCalls.length, 1);
      const call = runtime.fetchCalls[0];
      if (!call) throw new Error("prefetch fetch did not start");
      assertEquals(call.options.headers, { "X-Veryfront-Prefetch": "1" });
    });

    it("allows a failed speculative prefetch to be requested again later", async () => {
      const runtime = evaluateRouterRuntime({
        fetchImpl: () => {
          if (runtime.fetchCalls.length === 1) {
            return Promise.resolve({
              ok: false,
              status: 500,
              url: "/_veryfront/page-data/retry.json",
              headers: { get: () => null },
              json: () => Promise.resolve({}),
            });
          }

          return Promise.resolve(pageDataResponse("retry"));
        },
      });

      runtime.router.prefetch("/retry");

      for (let i = 0; i < 10 && runtime.fetchCalls.length < 2; i++) {
        await flushMicrotasks();
        runtime.router.prefetch("/retry");
      }

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/retry.json",
        "/_veryfront/page-data/retry.json",
      ]);
    });

    it("aborts active speculative prefetches and starts foreground navigation independently", async () => {
      const abortedPrefetches: string[] = [];
      const debugLogs: unknown[][] = [];
      const errorLogs: unknown[][] = [];
      const originalConsoleLog = console.log;
      const originalConsoleError = console.error;
      console.log = (...args: unknown[]) => {
        debugLogs.push(args);
      };
      console.error = (...args: unknown[]) => {
        errorLogs.push(args);
      };
      const runtime = evaluateRouterRuntime({
        debug: true,
        fetchImpl: (url, options) => {
          if (options.headers?.["X-Veryfront-Prefetch"] === "1") {
            return new Promise((_, reject) => {
              options.signal?.addEventListener("abort", () => {
                abortedPrefetches.push(url);
                reject(new DOMException("Aborted", "AbortError"));
              });
            });
          }

          return Promise.resolve(pageDataResponse("target"));
        },
      });
      try {
        runtime.win.__veryfrontHydrationComplete?.();

        runtime.router.prefetch("/target");
        runtime.router.prefetch("/other");
        runtime.router.prefetch("/queued");
        assertEquals(runtime.fetchCalls.length, 2);

        await runtime.navigateSPA("/target", true);

        assertEquals(abortedPrefetches.sort(), [
          "/_veryfront/page-data/other.json",
          "/_veryfront/page-data/target.json",
        ]);
        assertEquals(
          debugLogs.some((args) => String(args.join(" ")).includes("Page data prefetch failed")),
          false,
        );
        assertEquals(errorLogs, []);
        const navigationCall = runtime.fetchCalls[2];
        if (!navigationCall) throw new Error("foreground navigation fetch did not start");
        assertEquals(navigationCall.url, "/_veryfront/page-data/target.json");
        assertEquals(navigationCall.options.headers, { "X-Veryfront-Navigation": "spa" });
        assertEquals(runtime.router.pathname, "/target");
      } finally {
        console.log = originalConsoleLog;
        console.error = originalConsoleError;
      }
    });
  });
});
