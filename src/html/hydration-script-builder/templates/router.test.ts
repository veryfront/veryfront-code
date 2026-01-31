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

    it("should define prefetching on hover", () => {
      const result = getRouterScript();
      assertIncludes(result, "function prefetchPage(href)");
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
      assertIncludes(getRouterScript(), "veryfront-spa-css");
    });

    it("should update document title during SPA navigation", () => {
      assertIncludes(getRouterScript(), "document.title = pageData.frontmatter.title");
    });
  });
});
