import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_HTML_HYDRATION_DATA_BYTES } from "../../limits.ts";
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
      const result = getRouterScript();
      assertIncludes(result, "window.__veryfrontHydrationFailed");
      assertIncludes(result, "if (hydrationCompleted || hydrationFailed) return;");
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
      assertIncludes(result, "logBackgroundFetchFailure('Stale page data refresh', path, error)");
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
      assertIncludes(result, "function setCachedPageData(path, data, size)");
      assertIncludes(result, "MAX_PAGE_DATA_CACHE_BYTES");
    });

    it("should dedupe and throttle background page-data refreshes", () => {
      const result = getRouterScript();
      assertIncludes(result, "BACKGROUND_REFRESH_INTERVAL_MS = 30 * 1000");
      assertIncludes(result, "const pendingPageDataFetches = new Map()");
      assertIncludes(result, "function startPageDataFetch(path, signal, options = {})");
      assertIncludes(result, "function refreshPageDataInBackground(path)");
      assertIncludes(result, "pendingPageDataFetches.set(path, request)");
      assertIncludes(result, "refreshPageDataInBackground(path)");
      assertIncludes(result, "MAX_BACKGROUND_REFRESH_TIMESTAMPS = 100");
    });

    it("should reuse pending page-data fetches for first-hit navigation", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "log('Reusing pending page data fetch for navigation:', getSafeRoutePath(path))",
      );
      assertIncludes(result, "return handlePageDataVersionMismatch(path, data)");
      assertIncludes(
        result,
        "emitRouteTiming('page-data', path, startedAt, { source: 'deduped' });",
      );
    });

    it("does not log raw route queries or hydration error messages", () => {
      const result = getRouterScript();
      assertEquals(result.includes("log('Fetching page data:', path)"), false);
      assertEquals(result.includes("waitError.message"), false);
      assertIncludes(result, "const safePath = getSafeRoutePath(path)");
      assertIncludes(result, "log('Fetching page data:', safePath)");
    });

    it("validates page-data objects before caching or rendering", () => {
      const result = getRouterScript();
      assertIncludes(result, "function assertValidPageData(data)");
      assertIncludes(result, "const data = assertValidPageData(JSON.parse(responseText))");
      assertIncludes(result, "pageData = assertValidPageData(pageData)");
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
      assertIncludes(result, "cancelScheduledPrefetch();\n      void navigateSPA(href, true);");
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
      assertIncludes(result, "emitRouteTiming('total', targetPathname, navigationStartedAt");
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

    it("cancels stale progress completion timers before a new navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "let progressCompletionTimeout = null");
      assertIncludes(result, "let progressResetTimeout = null");
      assertIncludes(result, "function clearProgressCompletionTimers()");
      assertIncludes(result, "clearProgressCompletionTimers();");
    });

    it("should define fetchWithRetry with timeout and abort support", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function fetchWithRetry(url, options = {}, maxRetries");
      assertIncludes(result, "AbortController");
      assertIncludes(result, "options.signal?.addEventListener('abort'");
      assertIncludes(result, "options.signal?.removeEventListener('abort'");
    });

    it("should implement exponential backoff in retry", () => {
      assertIncludes(getRouterScript(), "Math.pow(2, attempt) * 500");
    });

    it("should define navigateSPA function", () => {
      assertIncludes(getRouterScript(), "async function navigateSPA(");
      assertIncludes(getRouterScript(), "pushState = true");
    });

    it("uses last-navigation-wins sequencing instead of dropping a replacement navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "let navigationSequence = 0");
      assertIncludes(result, "const navigationId = ++navigationSequence");
      const navigationBody = result.slice(
        result.indexOf("async function navigateSPA"),
        result.indexOf("async function loadPageDataComponent"),
      );
      assertEquals(navigationBody.includes("if (isNavigating) return;"), false);
    });

    it("builds page-data endpoints from pathname and preserves query parameters", () => {
      const result = getRouterScript();
      assertIncludes(result, "navigationUrl.pathname === '/'");
      assertIncludes(result, "? 'index'");
      assertIncludes(result, "+ navigationUrl.search");
    });

    it("should define renderPageFromData function", () => {
      assertIncludes(
        getRouterScript(),
        "async function renderPageFromData(pageData, targetPath, signal)",
      );
    });

    it("fails navigation when an advertised wrapper module cannot load", () => {
      const result = getRouterScript();
      assertIncludes(result, "throw new Error('Layout component failed to load')");
      assertIncludes(result, "throw new Error('App component failed to load')");
    });

    it("aborts stale navigation renders around asynchronous module loading", () => {
      const result = getRouterScript();
      assertIncludes(result, "await renderPageFromData(pageData, targetPathname, signal)");
      assertIncludes(result, "async function renderPageFromData(pageData, targetPath, signal)");
      assertIncludes(result, "throwIfAborted(signal);");
    });

    it("cancels and cleans up hydration waits when navigation is superseded", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function waitForHydration(signal)");
      assertIncludes(result, "signal?.addEventListener('abort', onAbort");
      assertIncludes(result, "signal?.removeEventListener('abort', onAbort)");
      assertIncludes(result, "clearTimeout(timeout)");
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
      assertIncludes(result, "selectComponentExport(module, path)");
      assertEquals(
        result.includes("module.MDXLayout || module.MainLayout || module.default || module"),
        false,
      );
    });

    it("should fall back to document navigation for server-layout page targets", () => {
      const result = getRouterScript();
      assertIncludes(result, "if (pageData.requiresFullDocumentNavigation) {");
      assertIncludes(result, "throw new Error('Server layout requires full document navigation');");
      assertIncludes(result, "window.location.href = normalizedHref;");
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
      assertIncludes(result, "componentLoader.loadComponent(modulePath)");
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

    it("restores the active release mapping after resolving prefetch URLs", () => {
      const result = getRouterScript();
      assertIncludes(result, "const previousReleaseId = window.__veryfrontReleaseId || null");
      assertIncludes(
        result,
        "const previousReleaseAssetModules = window.__veryfrontReleaseAssetModules || null",
      );
      assertIncludes(result, "window.__veryfrontSetReleaseId?.(previousReleaseId)");
      assertIncludes(
        result,
        "window.__veryfrontSetReleaseAssetModules?.(previousReleaseAssetModules)",
      );
    });

    it("should schedule capped idle and viewport prefetch for eligible internal links", () => {
      const result = getRouterScript();
      assertIncludes(result, "IDLE_PREFETCH_DELAY_MS = 1200");
      assertIncludes(result, "IDLE_PREFETCH_MAX_LINKS = 4");
      assertIncludes(result, "VIEWPORT_PREFETCH_MAX_LINKS = 8");
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

    it("disconnects stale viewport observations before refreshing route links", () => {
      const result = getRouterScript();
      assertIncludes(result, "observer.disconnect();");
      assertEquals(result.includes("const observedPrefetchLinks = new WeakSet()"), false);
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

    it("uses replaceState for router.replace without affecting popstate rendering", () => {
      const result = getRouterScript();
      assertIncludes(result, "replace: (path) =>");
      assertIncludes(result, "navigateSPA(path, false, false, true)");
      assertIncludes(result, "window.history.replaceState({ pageData, scrollY: 0 }");
    });

    it("should expose router on window", () => {
      assertIncludes(getRouterScript(), "window.__veryfrontRouter = router");
    });

    it("should normalize route params joining catch-all segments", () => {
      const result = getRouterScript();
      assertIncludes(result, "function normalizeRouteParams(raw)");
      assertIncludes(result, "const joined = value.join('/')");
    });

    it("should refresh router params during SPA and popstate navigation", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);",
      );
      assertIncludes(
        result,
        "window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);",
      );
    });

    it("should handle popstate events for browser back/forward", () => {
      const result = getRouterScript();
      assertIncludes(result, "addEventListener('popstate'");
      assertIncludes(result, "const popstateNavigationId = ++navigationSequence");
      assertIncludes(result, "await renderPageFromData(pageData, path, popstateSignal)");
      assertIncludes(result, "if (popstateNavigationId === navigationSequence)");
    });

    it("should intercept link clicks for SPA navigation", () => {
      const result = getRouterScript();
      assertIncludes(result, "addEventListener('click'");
      assertIncludes(result, "closest('a[href]')");
      assertIncludes(result, "typeof e.target.closest !== 'function'");
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
      replace(path: string): void;
    }
    interface RuntimeWindow {
      location: RuntimeLocation;
      history: { pushState(): void; replaceState(): void; back(): void; forward(): void };
      addEventListener(type: string, fn: (e: unknown) => void): void;
      dispatchEvent(): boolean;
      scrollTo(): void;
      scrollY: number;
      __veryfrontRouter?: RuntimeRouter;
      __veryfrontHydrationComplete?: () => void;
    }
    interface RuntimeHandle {
      router: RuntimeRouter;
      navigateSPA: (
        href: string,
        pushState?: boolean,
        restoreScroll?: boolean,
        replaceState?: boolean,
      ) => Promise<void>;
      win: RuntimeWindow;
      listeners: Record<string, Array<(e: unknown) => void>>;
      setNextPageData: (data: unknown) => void;
      setFetchHandler: (
        handler: ((url: string, options?: { signal?: AbortSignal }) => Promise<unknown>) | null,
      ) => void;
      requestedUrls: string[];
      fetchWithRetry: (
        url: string,
        options: { signal?: AbortSignal },
        maxRetries?: number,
      ) => Promise<unknown>;
      // The router.params snapshot captured the moment renderPageFromData built
      // the RouterProvider element, which is what the new page renders with. This is
      // what the ordering bug (mutating params after render) would get wrong.
      getRenderedParams: () => Record<string, string> | null;
      // The `params` prop handed to the page component during render must be
      // normalized (joined) so it matches the server render.
      getRenderedPageParams: () => Record<string, string> | null;
      normalizeRouteParams: (value: unknown) => Record<string, string>;
      assertValidPageData: (value: unknown) => Record<string, unknown>;
      historyCalls: Array<{ method: string; href: string }>;
    }

    function evaluateRouterRuntime(
      opts: {
        pathname?: string;
        search?: string;
        hydrationParams?: Record<string, string | string[]>;
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

      const historyCalls: Array<{ method: string; href: string }> = [];
      const win: RuntimeWindow = {
        location: {
          origin: "https://veryfront.test",
          pathname: opts.pathname ?? "/",
          search: opts.search ?? "",
          get href() {
            return "https://veryfront.test" + this.pathname + this.search;
          },
        },
        history: {
          pushState(_state?: unknown, _unused?: string, href?: string) {
            historyCalls.push({ method: "push", href: href ?? "" });
          },
          replaceState(_state?: unknown, _unused?: string, href?: string) {
            historyCalls.push({ method: "replace", href: href ?? "" });
          },
          back() {},
          forward() {},
        },
        addEventListener,
        dispatchEvent() {
          return true;
        },
        scrollTo() {},
        scrollY: 0,
      };

      let nextPageData: unknown = { pagePath: "page", params: {} };
      let fetchHandler:
        | ((url: string, options?: { signal?: AbortSignal }) => Promise<unknown>)
        | null = null;
      const requestedUrls: string[] = [];
      const fetchStub = (url: string, options?: { signal?: AbortSignal }) => {
        requestedUrls.push(url);
        if (fetchHandler) return fetchHandler(url, options);
        const serialized = JSON.stringify(nextPageData);
        return (
          Promise.resolve({
            ok: true,
            status: 200,
            url: "/_veryfront/page-data/page.json",
            headers: {
              get: (name: string) =>
                name.toLowerCase() === "content-length" ? String(serialized.length) : null,
            },
            json: () => Promise.resolve(nextPageData),
            text: () => Promise.resolve(serialized),
          })
        );
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
        "assertSafeModulePath",
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        getRouterScript() +
          "\nreturn { router, navigateSPA, fetchWithRetry, normalizeRouteParams, assertValidPageData };",
      );

      const handle = factory(
        win,
        doc,
        fetchStub,
        React,
        RouterProvider,
        PageContextProvider,
        loadComponent,
        (path: unknown) => {
          if (typeof path !== "string" || !path || path.includes("..")) {
            throw new TypeError("unsafe path");
          }
        },
        () => 0,
        () => {},
        (callback: () => void) => callback(),
      ) as {
        router: RuntimeRouter;
        navigateSPA: RuntimeHandle["navigateSPA"];
        fetchWithRetry: RuntimeHandle["fetchWithRetry"];
        normalizeRouteParams: RuntimeHandle["normalizeRouteParams"];
        assertValidPageData: RuntimeHandle["assertValidPageData"];
      };

      return {
        router: handle.router,
        navigateSPA: handle.navigateSPA,
        win,
        listeners,
        requestedUrls,
        fetchWithRetry: handle.fetchWithRetry,
        normalizeRouteParams: handle.normalizeRouteParams,
        assertValidPageData: handle.assertValidPageData,
        historyCalls,
        setNextPageData: (data: unknown) => {
          nextPageData = data;
        },
        setFetchHandler: (handler) => {
          fetchHandler = handler;
        },
        getRenderedParams: () => renderedRouterParams,
        getRenderedPageParams: () => renderedPageParams,
      };
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
      // The new page must render with the fresh params, not the previous
      // route's params. This only holds if params are updated before render.
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

    it("preserves queries in page-data requests while keeping pathname query-free", async () => {
      const runtime = evaluateRouterRuntime({ pathname: "/", hydrationParams: {} });
      runtime.win.__veryfrontHydrationComplete?.();
      runtime.setNextPageData({ pagePath: "page", params: {} });

      await runtime.navigateSPA("/?page=2#intro", true);

      assertEquals(runtime.requestedUrls.at(-1), "/_veryfront/page-data/index.json?page=2");
      assertEquals(runtime.router.pathname, "/");
      assertEquals(runtime.router.query, { page: "2" });
    });

    it("cancels oversized streamed page-data bodies before text allocation", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();
      let bodyCancelled = false;
      let textCalled = false;
      const oversizedChunk = new Uint8Array(MAX_HTML_HYDRATION_DATA_BYTES + 1);
      runtime.setFetchHandler(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          url: "/_veryfront/page-data/large.json",
          headers: { get: () => null },
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(oversizedChunk);
            },
            cancel() {
              bodyCancelled = true;
            },
          }),
          text() {
            textCalled = true;
            return Promise.resolve('{"pagePath":"page","params":{}}');
          },
        })
      );

      await runtime.navigateSPA("/large", true);

      assertEquals(textCalled, false);
      assertEquals(bodyCancelled, true);
    });

    it("rejects traversal hidden behind arbitrary percent-encoding layers", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();
      let traversal = "%2e%2e";
      for (let layer = 0; layer < 12; layer++) {
        traversal = traversal.replaceAll("%", "%25");
      }

      await runtime.navigateSPA(`/safe/${traversal}/private`, true);

      assertEquals(runtime.requestedUrls, []);
      assertEquals(runtime.historyCalls, []);
    });

    it("rejects encoded delimiters, controls, and bidirectional formatting characters", async () => {
      for (const encoded of ["%3f", "%23", "%c2%85", "%e2%80%ae"]) {
        const runtime = evaluateRouterRuntime();
        runtime.win.__veryfrontHydrationComplete?.();
        await runtime.navigateSPA(`/safe/${encoded}/page`, true);
        assertEquals(runtime.requestedUrls, []);
        assertEquals(runtime.historyCalls, []);
      }
    });

    it("rejects an already-aborted caller signal before fetch", async () => {
      const runtime = evaluateRouterRuntime();
      const controller = new AbortController();
      controller.abort();
      const fetchCount = runtime.requestedUrls.length;

      await assertRejects(
        () => runtime.fetchWithRetry("/test", { signal: controller.signal }, 0),
        DOMException,
        "aborted",
      );
      assertEquals(runtime.requestedUrls.length, fetchCount);
    });

    it("uses replaceState for router.replace navigation", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();
      runtime.setNextPageData({ pagePath: "page", params: {} });

      runtime.router.replace("/replacement");
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(runtime.historyCalls.at(-1), {
        method: "replace",
        href: "/replacement",
      });
    });

    it("normalizes only safe own route-param properties", () => {
      const runtime = evaluateRouterRuntime();
      const input = Object.create({ inherited: "ignored" }) as Record<string, unknown>;
      input.id = "42";
      Object.defineProperty(input, "__proto__", {
        configurable: true,
        enumerable: true,
        value: "unsafe",
      });
      input.object = { nested: true };

      assertEquals(runtime.normalizeRouteParams(input), { id: "42" });
    });

    it("rejects page data whose bounded nested fields are malformed", () => {
      const runtime = evaluateRouterRuntime();

      assertThrows(
        () =>
          runtime.assertValidPageData({
            pagePath: "page",
            headings: [{ id: 42, text: "Heading", level: 2 }],
          }),
        TypeError,
        "heading",
      );
      assertThrows(
        () =>
          runtime.assertValidPageData({
            pagePath: "page",
            headings: [{ id: "invalid", text: "Heading", level: 7 }],
          }),
        TypeError,
        "heading",
      );
      assertThrows(
        () =>
          runtime.assertValidPageData({
            pagePath: "page",
            params: Object.fromEntries(
              Array.from({ length: 101 }, (_, index) => [`param-${index}`, "value"]),
            ),
          }),
        TypeError,
        "params",
      );
      assertThrows(
        () =>
          runtime.assertValidPageData({
            pagePath: "page",
            releaseAssetModules: Object.fromEntries(
              Array.from({ length: 10_001 }, (_, index) => [
                `pages/${index}.tsx`,
                `/_vf/assets/${"a".repeat(64)}.js`,
              ]),
            ),
          }),
        TypeError,
        "release asset",
      );
    });

    it("completes the newest navigation when it supersedes an in-flight route", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();
      runtime.setFetchHandler((url, options) => {
        if (url.includes("/first.json")) {
          return new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true },
            );
          });
        }

        const serialized = JSON.stringify({ pagePath: "page", params: { id: "second" } });
        return Promise.resolve({
          ok: true,
          status: 200,
          url,
          headers: { get: () => String(serialized.length) },
          text: () => Promise.resolve(serialized),
        });
      });

      const first = runtime.navigateSPA("/first", true);
      await Promise.resolve();
      const second = runtime.navigateSPA("/second", true);
      await Promise.all([first, second]);

      assertEquals(runtime.router.pathname, "/second");
      assertEquals(runtime.router.params, { id: "second" });
      assertEquals(runtime.historyCalls.at(-1), { method: "push", href: "/second" });
    });

    it("ignores click events whose target cannot resolve a closest link", () => {
      const runtime = evaluateRouterRuntime();
      const click = runtime.listeners.click?.[0];
      if (!click) throw new Error("click handler was not registered");

      click({ target: {}, button: 0 });
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
  });
});
