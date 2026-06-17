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
      assertIncludes(result, "emitRouteTiming('total', targetPath, navigationStartedAt");
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
      assertIncludes(getRouterScript(), "async function navigateSPA(href, pushState");
    });

    it("should define renderPageFromData function", () => {
      assertIncludes(getRouterScript(), "async function renderPageFromData(pageData, targetPath)");
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
      assertIncludes(result, "loadComponent(modulePath)");
      assertIncludes(result, "PREFETCH_DELAY_MS");
      assertIncludes(result, "MAX_PREFETCH_PATHS = 100");
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
});
