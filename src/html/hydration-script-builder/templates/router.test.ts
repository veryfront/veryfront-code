import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRouterScript } from "./router.ts";

describe("hydration-script-builder/templates/router", () => {
  describe("getRouterScript", () => {
    it("should return a non-empty string", () => {
      const result = getRouterScript();
      assertEquals(typeof result, "string");
      assertEquals(result.length > 0, true);
    });

    it("should define MODULE_SERVER_URL from window origin", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.location.origin + '/_vf_modules'"), true);
    });

    it("should define hydration state tracking", () => {
      const result = getRouterScript();
      assertEquals(result.includes("hydrationResolve"), true);
      assertEquals(result.includes("hydrationReject"), true);
      assertEquals(result.includes("hydrationPromise"), true);
      assertEquals(result.includes("hydrationCompleted"), true);
      assertEquals(result.includes("hydrationFailed"), true);
    });

    it("should expose hydration complete callback on window", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.__veryfrontHydrationComplete"), true);
    });

    it("should expose hydration failed callback on window", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.__veryfrontHydrationFailed"), true);
    });

    it("should define DEBUG flag from URL params or window property", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.__VERYFRONT_DEBUG__"), true);
      assertEquals(result.includes("vf_debug"), true);
    });

    it("should define FETCH_TIMEOUT_MS constant", () => {
      const result = getRouterScript();
      assertEquals(result.includes("FETCH_TIMEOUT_MS = 10000"), true);
    });

    it("should define MAX_RETRIES constant", () => {
      const result = getRouterScript();
      assertEquals(result.includes("MAX_RETRIES = 2"), true);
    });

    it("should define MAX_CACHE_SIZE constant", () => {
      const result = getRouterScript();
      assertEquals(result.includes("MAX_CACHE_SIZE = 50"), true);
    });

    it("should define CACHE_TTL_MS constant (5 minutes)", () => {
      const result = getRouterScript();
      assertEquals(result.includes("CACHE_TTL_MS = 5 * 60 * 1000"), true);
    });

    it("should define debug logging functions", () => {
      const result = getRouterScript();
      assertEquals(result.includes("const log = DEBUG"), true);
      assertEquals(result.includes("const logError = console.error"), true);
    });

    it("should define version tracking for cache invalidation", () => {
      const result = getRouterScript();
      assertEquals(result.includes("function checkVersionMismatch(newVersion)"), true);
      assertEquals(result.includes("clientBuildVersion"), true);
    });

    it("should check serverStart in version mismatch", () => {
      const result = getRouterScript();
      assertEquals(result.includes("newVersion.serverStart"), true);
    });

    it("should check framework version in version mismatch", () => {
      const result = getRouterScript();
      assertEquals(result.includes("newVersion.framework"), true);
    });

    it("should check projectUpdated in version mismatch", () => {
      const result = getRouterScript();
      assertEquals(result.includes("newVersion.projectUpdated"), true);
    });

    it("should define LRU page data cache with TTL", () => {
      const result = getRouterScript();
      assertEquals(result.includes("function getCachedPageData(path)"), true);
      assertEquals(result.includes("function setCachedPageData(path, data)"), true);
    });

    it("should define scroll position memory", () => {
      const result = getRouterScript();
      assertEquals(result.includes("function saveScrollPosition(path)"), true);
      assertEquals(result.includes("function restoreScrollPosition(path)"), true);
      assertEquals(result.includes("MAX_SCROLL_POSITIONS = 100"), true);
    });

    it("should define loading progress indicator", () => {
      const result = getRouterScript();
      assertEquals(result.includes("function showNavigationProgress()"), true);
      assertEquals(result.includes("function hideNavigationProgress()"), true);
      assertEquals(result.includes("vf-nav-progress"), true);
    });

    it("should define fetchWithRetry with timeout and abort support", () => {
      const result = getRouterScript();
      assertEquals(result.includes("async function fetchWithRetry(url, options, maxRetries"), true);
      assertEquals(result.includes("AbortController"), true);
    });

    it("should implement exponential backoff in retry", () => {
      const result = getRouterScript();
      assertEquals(result.includes("Math.pow(2, attempt) * 500"), true);
    });

    it("should define navigateSPA function", () => {
      const result = getRouterScript();
      assertEquals(result.includes("async function navigateSPA(href, pushState"), true);
    });

    it("should define renderPageFromData function", () => {
      const result = getRouterScript();
      assertEquals(
        result.includes("async function renderPageFromData(pageData, targetPath)"),
        true,
      );
    });

    it("should define prefetching on hover", () => {
      const result = getRouterScript();
      assertEquals(result.includes("function prefetchPage(href)"), true);
      assertEquals(result.includes("PREFETCH_DELAY_MS"), true);
      assertEquals(result.includes("MAX_PREFETCH_PATHS = 100"), true);
    });

    it("should define router object with standard methods", () => {
      const result = getRouterScript();
      assertEquals(result.includes("const router = {"), true);
      assertEquals(result.includes("push:"), true);
      assertEquals(result.includes("replace:"), true);
      assertEquals(result.includes("back:"), true);
      assertEquals(result.includes("forward:"), true);
      assertEquals(result.includes("prefetch:"), true);
      assertEquals(result.includes("navigate:"), true);
      assertEquals(result.includes("reload:"), true);
    });

    it("should expose router on window", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.__veryfrontRouter = router"), true);
    });

    it("should handle popstate events for browser back/forward", () => {
      const result = getRouterScript();
      assertEquals(result.includes("addEventListener('popstate'"), true);
    });

    it("should intercept link clicks for SPA navigation", () => {
      const result = getRouterScript();
      assertEquals(result.includes("addEventListener('click'"), true);
      assertEquals(result.includes("closest('a[href]')"), true);
    });

    it("should skip external links and modifier key clicks", () => {
      const result = getRouterScript();
      assertEquals(result.includes("target === '_blank'"), true);
      assertEquals(result.includes("e.metaKey"), true);
      assertEquals(result.includes("e.ctrlKey"), true);
      assertEquals(result.includes("e.shiftKey"), true);
    });

    it("should handle hash-only links", () => {
      const result = getRouterScript();
      assertEquals(result.includes("href.startsWith('#')"), true);
      assertEquals(result.includes("scrollIntoView"), true);
    });

    it("should set up mouseenter for prefetch with debounce", () => {
      const result = getRouterScript();
      assertEquals(result.includes("addEventListener(\n      'mouseenter'"), true);
    });

    it("should set up mouseleave to cancel prefetch", () => {
      const result = getRouterScript();
      assertEquals(result.includes("addEventListener(\n      'mouseleave'"), true);
    });

    it("should expose useRouter on window", () => {
      const result = getRouterScript();
      assertEquals(result.includes("window.useRouter"), true);
    });

    it("should set aria-busy during navigation", () => {
      const result = getRouterScript();
      assertEquals(result.includes("setAttribute('aria-busy', 'true')"), true);
      assertEquals(result.includes("removeAttribute('aria-busy')"), true);
    });

    it("should inject CSS for SPA navigation in renderPageFromData", () => {
      const result = getRouterScript();
      assertEquals(result.includes("veryfront-spa-css"), true);
    });

    it("should update document title during SPA navigation", () => {
      const result = getRouterScript();
      assertEquals(result.includes("document.title = pageData.frontmatter.title"), true);
    });
  });
});
