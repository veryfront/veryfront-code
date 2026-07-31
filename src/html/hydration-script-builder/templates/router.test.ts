import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getRouterScript } from "./router.ts";

function assertIncludes(haystack: string, needle: string): void {
  assertEquals(haystack.includes(needle), true);
}

function extractGeneratedFunction(declaration: string): string {
  const script = getRouterScript();
  const start = script.indexOf(declaration);
  assertEquals(start >= 0, true, declaration + " not found in router script");
  const end = script.indexOf("\n    }", start);
  assertEquals(end > start, true, "could not find end of " + declaration);
  return script.slice(start, end + "\n    }".length);
}

type ImportModule = (moduleUrl: string) => Promise<unknown>;

function importSnapshotBoundModule(
  moduleUrl: string,
  importModule: ImportModule,
  fetchModule: typeof fetch,
  reloadDocument: () => void,
  recoveryState: Record<string, unknown>,
  allowDocumentReload = true,
): Promise<unknown> {
  const source = [
    extractGeneratedFunction("async function isDependencySnapshotConflictResponse("),
    extractGeneratedFunction("async function recoverFromSnapshotBoundModuleFailure("),
    extractGeneratedFunction("async function importSnapshotBoundModule("),
  ].join("\n");

  return new Function(
    "moduleUrl",
    "importModule",
    "fetchModule",
    "reloadDocument",
    "recoveryState",
    "allowDocumentReload",
    source +
      "\nreturn importSnapshotBoundModule(" +
      "moduleUrl, importModule, fetchModule, reloadDocument, recoveryState, allowDocumentReload);",
  )(
    moduleUrl,
    importModule,
    fetchModule,
    reloadDocument,
    recoveryState,
    allowDocumentReload,
  ) as Promise<unknown>;
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the generated module import to reject");
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

    it("should compare serverStart only for explicit development hydration", () => {
      const result = getRouterScript();
      assertIncludes(result, "compareServerStart = data?.dev === true");
      assertIncludes(result, "? ['serverStart', 'framework', 'projectUpdated']");
    });

    it("should check framework version in version mismatch", () => {
      assertIncludes(getRouterScript(), "'framework'");
    });

    it("should check projectUpdated in version mismatch", () => {
      assertIncludes(getRouterScript(), "'projectUpdated'");
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
      assertIncludes(result, "pendingPageDataFetches.set(cacheIdentity, pendingEntry)");
      assertIncludes(result, "refreshPageDataInBackground(path)");
    });

    it("binds page-data requests and cache identities to the document dependency snapshot", () => {
      const result = getRouterScript();
      assertIncludes(result, "const DOCUMENT_DEPENDENCY_PINNING_CACHE_KEY =");
      assertIncludes(result, "function pageDataCacheIdentity(path)");
      assertIncludes(result, "function buildPageDataEndpoint(path)");
      assertIncludes(
        result,
        "headers['X-Veryfront-Dependency-Pins'] = DOCUMENT_DEPENDENCY_PINNING_CACHE_KEY",
      );
      assertIncludes(result, "assertPageDataMatchesDocumentSnapshot(path, await response.json())");
    });

    it("starts dependency-snapshot document recovery only once", () => {
      const source = extractGeneratedFunction(
        "function navigateForDependencySnapshotMismatch(",
      );
      let assignments = 0;
      let assignedHref = "";
      const runtimeWindow = {
        location: {
          set href(value: string) {
            assignments++;
            assignedHref = value;
          },
        },
      };
      const navigate = new Function(
        "window",
        `${source}\nreturn navigateForDependencySnapshotMismatch;`,
      )(runtimeWindow) as (href: string) => void;

      navigate("/first");
      navigate("/second");

      assertEquals(assignments, 1);
      assertEquals(assignedHref, "/first");
    });

    it("should reuse pending page-data fetches for first-hit navigation", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "log('Reusing pending page data fetch for navigation:', routePathname)",
      );
      assertIncludes(result, "return handlePageDataVersionMismatch(path, data)");
      assertIncludes(
        result,
        "emitRouteTiming('page-data', routePathname, startedAt, { source: 'deduped' });",
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
      assertIncludes(
        result,
        "emitRouteTiming('page-data', routePathname, startedAt, { source: 'cache' });",
      );
      assertIncludes(
        result,
        "emitRouteTiming('page-data', routePathname, startedAt, { source: 'deduped' });",
      );
    });

    it("should define scroll position memory", () => {
      const result = getRouterScript();
      assertIncludes(result, "function saveScrollPosition(path)");
      assertIncludes(result, "function restoreScrollPosition(path, navigation)");
      assertIncludes(result, "MAX_SCROLL_POSITIONS = 100");
    });

    it("should define loading progress indicator", () => {
      const result = getRouterScript();
      assertIncludes(result, "function showNavigationProgress(navigationId)");
      assertIncludes(result, "function hideNavigationProgress(navigationId)");
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
      assertIncludes(getRouterScript(), "async function navigateSPA(\n      href,");
    });

    it("should define renderPageFromData function", () => {
      assertIncludes(
        getRouterScript(),
        "async function renderPageFromData(pageData, targetPath, navigation, commitNavigationState)",
      );
    });

    it("should resolve isolated page-island modules through release assets then RSC", () => {
      const result = getRouterScript();
      assertIncludes(result, "async function loadPageDataComponent(pageData, path, options = {})");
      assertIncludes(
        result,
        "const moduleUrl = resolveHydrationModuleUrl(",
      );
      assertIncludes(result, "pageData.releaseAssetModules || null");
      assertIncludes(result, "const component = await loadComponentFromUrl(");
      assertIncludes(result, "options,");
      assertIncludes(
        result,
        "allPaths.map((path) => loadPageDataComponent(pageData, path))",
      );
    });

    it("reloads once when pinned page, layout, app, and error imports hit snapshot eviction", async () => {
      const importedUrls: string[] = [];
      const probedUrls: string[] = [];
      const cacheModes: (RequestCache | undefined)[] = [];
      const recoveryState: Record<string, unknown> = {};
      let reloads = 0;

      for (
        const path of [
          "app/page.tsx",
          "app/layout.tsx",
          "components/app.tsx",
          "app/error.tsx",
        ]
      ) {
        const moduleUrl = `/_veryfront/rsc/module?rel=${
          encodeURIComponent(path)
        }&pins=on%3Asnapshot-a`;
        const importError = new TypeError(`dynamic import failed: ${path}`);
        const thrown = await captureRejection(
          importSnapshotBoundModule(
            moduleUrl,
            (url) => {
              importedUrls.push(url);
              return Promise.reject(importError);
            },
            (input, init) => {
              probedUrls.push(String(input));
              cacheModes.push((init as { cache?: RequestCache } | undefined)?.cache);
              return Promise.resolve(
                new Response("export default null; // Unknown dependency snapshot", {
                  status: 409,
                  headers: { "content-type": "application/javascript" },
                }),
              );
            },
            () => {
              reloads++;
            },
            recoveryState,
          ),
        );

        assertEquals(thrown, importError);
      }

      assertEquals(importedUrls.length, 4);
      assertEquals(probedUrls, importedUrls);
      assertEquals(cacheModes, ["no-store", "no-store", "no-store", "no-store"]);
      assertEquals(reloads, 1);
      assertEquals(
        recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__,
        true,
      );
    });

    it("recovers module-server path-pinned imports used by the shared component loader", async () => {
      const moduleUrl = "/_vf_modules/_pins/on%3Asnapshot-a/app/layout.js";
      const importError = new TypeError("dynamic import failed");
      const probedUrls: string[] = [];
      let reloads = 0;

      const thrown = await captureRejection(
        importSnapshotBoundModule(
          moduleUrl,
          () => Promise.reject(importError),
          (input, init) => {
            probedUrls.push(String(input));
            assertEquals(
              (init as { cache?: RequestCache } | undefined)?.cache,
              "no-store",
            );
            return Promise.resolve(
              new Response("Unknown dependency snapshot", { status: 409 }),
            );
          },
          () => {
            reloads++;
          },
          {},
        ),
      );

      assertEquals(thrown, importError);
      assertEquals(probedUrls, [moduleUrl]);
      assertEquals(reloads, 1);
    });

    it("reports speculative snapshot conflicts without reloading the document", async () => {
      const moduleUrl = "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a";
      let reloads = 0;
      const recoveryState: Record<string, unknown> = {};

      const thrown = await captureRejection(
        importSnapshotBoundModule(
          moduleUrl,
          () => Promise.reject(new TypeError("dynamic import failed")),
          () =>
            Promise.resolve(
              new Response("Unknown dependency snapshot", { status: 409 }),
            ),
          () => {
            reloads++;
          },
          recoveryState,
          false,
        ),
      ) as Error & { dependencySnapshotConflict?: boolean };

      assertEquals(thrown.name, "DependencySnapshotConflictError");
      assertEquals(thrown.dependencySnapshotConflict, true);
      assertEquals(reloads, 0);
      assertEquals(
        recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__,
        undefined,
      );
    });

    it("preserves arbitrary import failures without probing or reloading them", async () => {
      const importError = new SyntaxError("module evaluation failed");
      let probes = 0;
      let reloads = 0;
      const recoveryState: Record<string, unknown> = {};

      const unpinnedThrown = await captureRejection(
        importSnapshotBoundModule(
          "/_veryfront/rsc/module?rel=app%2Fpage.tsx",
          () => Promise.reject(importError),
          () => {
            probes++;
            return Promise.resolve(
              new Response("Unknown dependency snapshot", { status: 409 }),
            );
          },
          () => {
            reloads++;
          },
          recoveryState,
        ),
      );
      const applicationConflictThrown = await captureRejection(
        importSnapshotBoundModule(
          "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
          () => Promise.reject(importError),
          () => {
            probes++;
            return Promise.resolve(
              new Response("Application conflict", { status: 409 }),
            );
          },
          () => {
            reloads++;
          },
          recoveryState,
        ),
      );

      assertEquals(unpinnedThrown, importError);
      assertEquals(applicationConflictThrown, importError);
      assertEquals(probes, 1);
      assertEquals(reloads, 0);
      assertEquals(
        recoveryState.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__,
        undefined,
      );
    });

    it("should fall back to document navigation for server-layout page targets", () => {
      const result = getRouterScript();
      assertIncludes(result, "if (pageData.requiresFullDocumentNavigation) {");
      assertIncludes(result, "throw new Error('Server layout requires full document navigation');");
      assertIncludes(result, "window.location.href = resolvedHref;");
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
      assertIncludes(
        result,
        "loadPageDataComponent(pageData, modulePath, { allowDocumentReload: false })",
      );
      assertIncludes(result, "PREFETCH_DELAY_MS");
      assertIncludes(result, "MAX_PREFETCH_PATHS = 100");
    });

    it("should prefetch isolated modules securely and skip document-navigation targets", () => {
      const result = getRouterScript();
      assertIncludes(
        result,
        "async function loadPageDataComponent(pageData, path, options = {})",
      );
      assertIncludes(
        result,
        "if (!pageData || pageData.requiresFullDocumentNavigation) return;",
      );
      assertIncludes(
        result,
        "loadPageDataComponent(pageData, modulePath, { allowDocumentReload: false })",
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
        "await navigateSPA(href, 'none', true, e.state?.pageData);",
      );
    });

    it("should make the latest navigation the sole owner of commits and cleanup", () => {
      const result = getRouterScript();
      assertIncludes(result, "let navigationSequence = 0;");
      assertIncludes(result, "const navigationId = ++navigationSequence;");
      assertIncludes(result, "function assertLatestNavigation(navigation)");
      assertIncludes(result, "assertLatestNavigation(navigation);");
      assertIncludes(result, "currentAbortController === controller");
      assertEquals(
        result.includes("currentAbortController?.abort();\n\n      if (isNavigating) return;"),
        false,
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
      for (
        const token of [
          "link.target && link.target !== '_self'",
          "e.metaKey",
          "e.ctrlKey",
          "e.shiftKey",
        ]
      ) {
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
      hash: string;
      href: string;
      reload(): void;
    }
    interface RuntimeRouter {
      params: Record<string, string>;
      path: string;
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
    interface RuntimeElement {
      style: Record<string, unknown>;
      id: string;
      textContent: string;
      setAttribute(): void;
      getAttribute(): null;
      prepend(): void;
      remove(): void;
      appendChild(): void;
    }
    interface RuntimeWindow {
      location: RuntimeLocation;
      history: {
        pushState(state: unknown, unused: string, href: string): void;
        replaceState(state: unknown, unused: string, href: string): void;
        back(): void;
        forward(): void;
      };
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
      navigateSPA: (
        href: string,
        historyMode?: "push" | "replace" | "none",
        restoreScroll?: boolean,
        providedPageData?: unknown,
      ) => Promise<void>;
      fetchWithRetry: (
        url: string,
        options: { headers?: Record<string, string>; signal?: AbortSignal },
        maxRetries?: number,
      ) => Promise<unknown>;
      win: RuntimeWindow;
      listeners: Record<string, Array<(e: unknown) => void>>;
      setNextPageData: (data: unknown) => void;
      fetchCalls: RuntimeFetchCall[];
      historyCalls: Array<{ method: "push" | "replace"; href: string }>;
      getAssignedHref: () => string | null;
      isBodyBusy: () => boolean;
      getNavigationNotifications: () => number;
      moduleResolutionCalls: Array<{
        path: string;
        preferRscModule: boolean;
        studioEmbed: boolean;
        releaseAssetModules: Record<string, string> | null;
        releaseId: string | null;
      }>;
      // The router.params snapshot captured the moment renderPageFromData built
      // the RouterProvider element — i.e. what the new page renders with. This is
      // what the ordering bug (mutating params after render) would get wrong.
      getRenderedParams: () => Record<string, string> | null;
      // The `params` prop handed to the page component during render — must be
      // normalized (joined) so it matches the server render.
      getRenderedPageParams: () => Record<string, string> | null;
      getRouteCss: () => string | null;
      getReloads: () => number;
    }

    function evaluateRouterRuntime(
      opts: {
        pathname?: string;
        search?: string;
        hydrationParams?: Record<string, string | string[]>;
        hydrationBuildVersion?: {
          framework: string;
          serverStart: number;
          projectUpdated?: string;
        };
        hydrationDev?: boolean;
        activeReleaseId?: string;
        hydrationDependencyPinningCacheKey?: string;
        fetchImpl?: (
          url: string,
          options: { headers?: Record<string, string>; signal?: AbortSignal },
        ) => Promise<unknown>;
        loadComponentImpl?: (path: string) => Promise<unknown>;
        setTimeoutImpl?: (callback: () => void, delay: number) => number;
        clearTimeoutImpl?: (id: number) => void;
        importModuleImpl?: ImportModule;
        debug?: boolean;
      } = {},
    ): RuntimeHandle {
      const hydrationJson = JSON.stringify({
        params: opts.hydrationParams ?? {},
        buildVersion: opts.hydrationBuildVersion,
        dev: opts.hydrationDev,
        ...(opts.hydrationDependencyPinningCacheKey
          ? { dependencyPinningCacheKey: opts.hydrationDependencyPinningCacheKey }
          : {}),
      });
      const listeners: Record<string, Array<(e: unknown) => void>> = {};
      const addEventListener = (type: string, fn: (e: unknown) => void) => {
        (listeners[type] ??= []).push(fn);
      };

      let spaStyleEl: RuntimeElement | null = null;
      const makeEl = (): RuntimeElement => ({
        style: {},
        id: "",
        textContent: "",
        setAttribute() {},
        getAttribute() {
          return null;
        },
        prepend() {},
        remove() {
          if (spaStyleEl === this) spaStyleEl = null;
        },
        appendChild() {},
      });

      const bodyAttributes = new Set<string>();
      const rootEl = { __reactRoot: { render() {} } };
      const doc = {
        readyState: "complete",
        body: {
          prepend() {},
          setAttribute(name: string) {
            bodyAttributes.add(name);
          },
          removeAttribute(name: string) {
            bodyAttributes.delete(name);
          },
          appendChild() {},
        },
        head: {
          appendChild(element: RuntimeElement) {
            if (element.id === "veryfront-spa-css") spaStyleEl = element;
          },
        },
        createElement: () => makeEl(),
        querySelector: () => null,
        querySelectorAll: () => [] as unknown[],
        getElementById: (id: string) => {
          if (id === "veryfront-hydration-data") return { textContent: hydrationJson };
          if (id === "root") return rootEl;
          if (id === "veryfront-spa-css") return spaStyleEl;
          return null;
        },
        addEventListener,
      };

      let assignedHref: string | null = null;
      let reloads = 0;
      const historyCalls: RuntimeHandle["historyCalls"] = [];
      const location: RuntimeLocation = {
        origin: "https://veryfront.test",
        pathname: opts.pathname ?? "/",
        search: opts.search ?? "",
        hash: "",
        get href() {
          return assignedHref ??
            "https://veryfront.test" + this.pathname + this.search;
        },
        set href(value: string) {
          assignedHref = value;
        },
        reload() {
          reloads++;
        },
      };
      const win: RuntimeWindow = {
        location,
        history: {
          pushState(_state: unknown, _unused: string, href: string) {
            historyCalls.push({ method: "push", href });
          },
          replaceState(_state: unknown, _unused: string, href: string) {
            historyCalls.push({ method: "replace", href });
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
        __VERYFRONT_DEBUG__: opts.debug,
      };
      if (opts.activeReleaseId) {
        (win as RuntimeWindow & { __veryfrontReleaseId?: string }).__veryfrontReleaseId =
          opts.activeReleaseId;
      }

      let nextPageData: unknown = {
        pagePath: "page",
        params: {},
        ...(opts.hydrationDependencyPinningCacheKey
          ? { dependencyPinningCacheKey: opts.hydrationDependencyPinningCacheKey }
          : {}),
      };
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
          } else if (props && "params" in props) {
            renderedPageParams = { ...(props.params ?? {}) };
          }
          return {};
        },
      };
      const loadComponent = (path: string) =>
        opts.loadComponentImpl?.(path) ?? Promise.resolve(() => null);
      const moduleResolutionCalls: RuntimeHandle["moduleResolutionCalls"] = [];
      const resolveHydrationModuleUrl = (
        path: string,
        preferRscModule: boolean,
        studioEmbed: boolean,
        moduleData: { dependencyPinningCacheKey?: unknown } | null,
        releaseAssetModules: Record<string, string> | null,
        releaseId: string | null,
      ) => {
        moduleResolutionCalls.push({
          path,
          preferRscModule,
          studioEmbed,
          releaseAssetModules,
          releaseId,
        });

        if (
          !studioEmbed &&
          releaseAssetModules &&
          Object.prototype.hasOwnProperty.call(releaseAssetModules, path)
        ) {
          return releaseAssetModules[path];
        }

        if (preferRscModule) {
          let moduleUrl = "/_veryfront/rsc/module?rel=" + encodeURIComponent(path);
          const pinKey = moduleData?.dependencyPinningCacheKey;
          if (typeof pinKey === "string" && pinKey.startsWith("on:")) {
            moduleUrl += "&pins=" + encodeURIComponent(pinKey);
          }
          return moduleUrl;
        }

        return path;
      };
      const loadComponentFromUrl = async (
        path: string,
        moduleUrl: string,
        options: { allowDocumentReload?: boolean } = {},
      ) => {
        if (!opts.importModuleImpl) return loadComponent(path);

        const module = await importSnapshotBoundModule(
          moduleUrl,
          opts.importModuleImpl,
          fetchStub as typeof fetch,
          () => location.reload(),
          win as unknown as Record<string, unknown>,
          options.allowDocumentReload !== false,
        ) as Record<string, unknown>;
        return module.MDXLayout ?? module.MainLayout ?? module.default ?? module;
      };
      let navigationNotifications = 0;
      const navigationStore = {
        setNavigator() {},
        notify() {
          navigationNotifications++;
        },
      };

      const factory = new Function(
        "window",
        "document",
        "fetch",
        "React",
        "RouterProvider",
        "PageContextProvider",
        "loadComponent",
        "resolveHydrationModuleUrl",
        "loadComponentFromUrl",
        "setTimeout",
        "clearTimeout",
        "getNavigationStore",
        getRouterScript() + "\nreturn { router, navigateSPA, fetchWithRetry };",
      );

      const handle = factory(
        win,
        doc,
        fetchStub,
        React,
        RouterProvider,
        PageContextProvider,
        loadComponent,
        resolveHydrationModuleUrl,
        loadComponentFromUrl,
        opts.setTimeoutImpl ?? (() => 0),
        opts.clearTimeoutImpl ?? (() => {}),
        () => navigationStore,
      ) as {
        router: RuntimeRouter;
        navigateSPA: RuntimeHandle["navigateSPA"];
        fetchWithRetry: RuntimeHandle["fetchWithRetry"];
      };

      return {
        router: handle.router,
        navigateSPA: handle.navigateSPA,
        fetchWithRetry: handle.fetchWithRetry,
        win,
        listeners,
        setNextPageData: (data: unknown) => {
          nextPageData = data;
        },
        fetchCalls,
        historyCalls,
        getAssignedHref: () => assignedHref,
        isBodyBusy: () => bodyAttributes.has("aria-busy"),
        getNavigationNotifications: () => navigationNotifications,
        moduleResolutionCalls,
        getRenderedParams: () => renderedRouterParams,
        getRenderedPageParams: () => renderedPageParams,
        getRouteCss: () => spaStyleEl?.textContent ?? null,
        getReloads: () => reloads,
      };
    }

    function pageDataResponse(
      path = "page",
      pageData: unknown = { pagePath: path, params: {} },
    ): unknown {
      return {
        ok: true,
        status: 200,
        url: "/_veryfront/page-data/" + path + ".json",
        headers: { get: () => null },
        json: () => Promise.resolve(pageData),
      };
    }

    function deferred<T>(): {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (reason: unknown) => void;
    } {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      });
      return { promise, resolve, reject };
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

    it("replaces prior route CSS with an authoritative empty CSS string", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA(
        "/styled",
        "push",
        false,
        { pagePath: "page", params: {}, css: ".styled{color:red}" },
      );
      assertEquals(runtime.getRouteCss(), ".styled{color:red}");

      await runtime.navigateSPA(
        "/unstyled",
        "push",
        false,
        { pagePath: "page", params: {}, css: "" },
      );

      assertEquals(runtime.getRouteCss(), "");
    });

    it("rejects non-string CSS before honoring an explicit clear action", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA(
        "/styled",
        "push",
        false,
        { pagePath: "page", params: {}, css: ".styled{color:red}" },
      );
      await runtime.navigateSPA(
        "/release-styled",
        "push",
        false,
        {
          pagePath: "page",
          params: {},
          css: { malformed: true },
          cssAction: "clear",
        },
      );

      assertEquals(runtime.getRouteCss(), null);
    });

    it("seeds router params from hydration data, joining catch-all segments", () => {
      const { router } = evaluateRouterRuntime({
        pathname: "/docs/guides/intro",
        hydrationParams: { slug: ["guides", "intro"], lang: "en" },
      });
      assertEquals(router.params, { slug: "guides/intro", lang: "en" });
    });

    it("normalizes only own route params without prototype mutation", () => {
      const hydrationParams = Object.create({ inherited: "ignored" }) as Record<
        string,
        string | string[]
      >;
      Object.defineProperty(hydrationParams, "__proto__", {
        enumerable: true,
        value: ["safe", "value"],
      });

      const { router } = evaluateRouterRuntime({ hydrationParams });

      assertEquals(Object.keys(router.params), ["__proto__"]);
      assertEquals(Object.prototype.hasOwnProperty.call(router.params, "__proto__"), true);
      assertEquals(router.params["__proto__"], "safe/value");
      assertEquals(Object.getPrototypeOf(router.params), Object.prototype);
    });

    it("preserves route queries and binds page-data requests to the document snapshot", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationDependencyPinningCacheKey: "on:snapshot-a",
      });
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA("/search?pins=customer-value&q=one", "push");

      assertEquals(
        runtime.fetchCalls[0]?.url,
        "/_veryfront/page-data/search.json?pins=customer-value&q=one",
      );
      assertEquals(runtime.fetchCalls[0]?.options.headers, {
        "X-Veryfront-Navigation": "spa",
        "X-Veryfront-Dependency-Pins": "on:snapshot-a",
      });
    });

    it("falls back to a document navigation when page data returns another snapshot", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationDependencyPinningCacheKey: "on:snapshot-a",
      });
      runtime.win.__veryfrontHydrationComplete?.();
      runtime.setNextPageData({
        pagePath: "page",
        params: {},
        dependencyPinningCacheKey: "on:snapshot-b",
      });

      await runtime.navigateSPA("/target", "push");

      assertEquals(runtime.win.location.href, "/target");
      assertEquals(runtime.getRenderedParams(), null);
    });

    it("rejects history state from another dependency snapshot without refetching", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationDependencyPinningCacheKey: "on:snapshot-a",
      });
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA(
        "/target",
        "none",
        true,
        {
          pagePath: "page",
          params: {},
          dependencyPinningCacheKey: "on:snapshot-b",
        },
      );

      assertEquals(runtime.win.location.href, "/target");
      assertEquals(runtime.fetchCalls, []);
      assertEquals(runtime.getRenderedParams(), null);
    });

    it("rejects pinned fetched and history payloads for an unpinned document", async () => {
      const fetchedRuntime = evaluateRouterRuntime();
      fetchedRuntime.win.__veryfrontHydrationComplete?.();
      fetchedRuntime.setNextPageData({
        pagePath: "page",
        params: {},
        dependencyPinningCacheKey: "on:snapshot-a",
      });

      await fetchedRuntime.navigateSPA("/fetched", "push");
      assertEquals(fetchedRuntime.win.location.href, "/fetched");
      assertEquals(fetchedRuntime.getRenderedParams(), null);

      const historyRuntime = evaluateRouterRuntime();
      historyRuntime.win.__veryfrontHydrationComplete?.();
      await historyRuntime.navigateSPA(
        "/history",
        "none",
        true,
        {
          pagePath: "page",
          params: {},
          dependencyPinningCacheKey: "on:snapshot-a",
        },
      );
      assertEquals(historyRuntime.win.location.href, "/history");
      assertEquals(historyRuntime.fetchCalls, []);
      assertEquals(historyRuntime.historyCalls, []);
      assertEquals(historyRuntime.getRenderedParams(), null);
    });

    it("does not cache a pinned prefetch payload for an unpinned document", async () => {
      const pinnedPageData = {
        pagePath: "page",
        params: {},
        dependencyPinningCacheKey: "on:snapshot-a",
      };
      const runtime = evaluateRouterRuntime({
        fetchImpl: () => Promise.resolve(pageDataResponse("cached", pinnedPageData)),
      });

      runtime.router.prefetch("/cached");
      await flushUntil(() => runtime.fetchCalls.length === 1);
      for (let index = 0; index < 5; index++) await flushMicrotasks();

      runtime.win.__veryfrontHydrationComplete?.();
      await runtime.navigateSPA("/cached", "push");

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/cached.json",
        "/_veryfront/page-data/cached.json",
      ]);
      assertEquals(runtime.win.location.href, "/cached");
      assertEquals(runtime.historyCalls, []);
      assertEquals(runtime.getRenderedParams(), null);
    });

    it("falls back to a document navigation when the pinned snapshot is unavailable", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationDependencyPinningCacheKey: "on:snapshot-a",
        fetchImpl: () =>
          Promise.resolve({
            ok: false,
            status: 409,
            url: "/_veryfront/page-data/target.json?pins=on%3Asnapshot-a",
            headers: { get: () => null },
            json: () => Promise.resolve({}),
          }),
      });
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA("/target", "push");

      assertEquals(runtime.win.location.href, "/target");
      assertEquals(runtime.getRenderedParams(), null);
    });

    it("replaces stale params with new page data on SPA navigation", async () => {
      const runtime = evaluateRouterRuntime({
        pathname: "/posts/42",
        hydrationParams: { id: "42" },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      runtime.setNextPageData({ pagePath: "page", params: { id: "99" } });
      runtime.win.location.pathname = "/posts/99";
      await runtime.navigateSPA("/posts/99", "push");

      assertEquals(runtime.router.params, { id: "99" });
      assertEquals(runtime.router.pathname, "/posts/99");
      // The new page must render with the fresh params — not the previous
      // route's — which only holds if params are updated before render.
      assertEquals(runtime.getRenderedParams(), { id: "99" });
    });

    it("notifies shared router subscribers after a committed navigation", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA("/next", "push");

      assertEquals(runtime.getNavigationNotifications(), 1);
    });

    it("keeps query strings out of page-data paths and router.pathname", async () => {
      const testCases: Array<{
        href: string;
        endpoint: string;
        pathname: string;
        query: Record<string, string>;
      }> = [
        {
          href: "/catalog?sort=price&sort=rating",
          endpoint: "/_veryfront/page-data/catalog.json?sort=price&sort=rating",
          pathname: "/catalog",
          query: { sort: "rating" },
        },
        {
          href: "/?page=2",
          endpoint: "/_veryfront/page-data/index.json?page=2",
          pathname: "/",
          query: { page: "2" },
        },
      ];

      for (const testCase of testCases) {
        const runtime = evaluateRouterRuntime();
        runtime.win.__veryfrontHydrationComplete?.();

        await runtime.navigateSPA(testCase.href, "push");

        assertEquals(runtime.fetchCalls[0]?.url, testCase.endpoint);
        assertEquals(runtime.router.path, testCase.pathname);
        assertEquals(runtime.router.pathname, testCase.pathname);
        assertEquals(runtime.router.query, testCase.query);
        assertEquals(runtime.historyCalls, [{ method: "push", href: testCase.href }]);
        assertEquals(runtime.getNavigationNotifications(), 1);
      }
    });

    it("normalizes catch-all params for both router and page props on SPA nav", () => {
      const runtime = evaluateRouterRuntime({ pathname: "/", hydrationParams: {} });
      runtime.win.__veryfrontHydrationComplete?.();

      // Page data carries a raw catch-all array, as route matching produces it.
      runtime.setNextPageData({ pagePath: "page", params: { slug: ["guides", "intro"] } });
      return runtime.navigateSPA("/docs/guides/intro", "push").then(() => {
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
      await runtime.navigateSPA("/about", "push");

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

    it("starts a newer navigation immediately and lets only the latest response commit", async () => {
      const requests = new Map<
        string,
        ReturnType<typeof deferred<unknown>>
      >();
      const runtime = evaluateRouterRuntime({
        fetchImpl: (url) => {
          const request = deferred<unknown>();
          requests.set(url, request);
          return request.promise;
        },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      const firstNavigation = runtime.navigateSPA("/first", "push");
      await flushUntil(() => requests.has("/_veryfront/page-data/first.json"));

      const secondNavigation = runtime.navigateSPA("/second", "push");
      await flushUntil(() => requests.has("/_veryfront/page-data/second.json"));

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/first.json",
        "/_veryfront/page-data/second.json",
      ]);

      requests.get("/_veryfront/page-data/second.json")?.resolve(
        pageDataResponse("page-b", { pagePath: "page-b", params: { owner: "second" } }),
      );
      await secondNavigation;

      requests.get("/_veryfront/page-data/first.json")?.resolve(
        pageDataResponse("page-a", { pagePath: "page-a", params: { owner: "first" } }),
      );
      await firstNavigation;

      assertEquals(runtime.router.pathname, "/second");
      assertEquals(runtime.router.params, { owner: "second" });
      assertEquals(runtime.getRenderedPageParams(), { owner: "second" });
      assertEquals(runtime.historyCalls, [{ method: "push", href: "/second" }]);
      assertEquals(runtime.isBodyBusy(), false);
    });

    it("starts a fresh request when a same-href navigation supersedes an aborted owner", async () => {
      let requestCount = 0;
      const runtime = evaluateRouterRuntime({
        fetchImpl: (_url, options) => {
          requestCount++;
          if (requestCount === 1) {
            return new Promise((_, reject) => {
              options.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              }, { once: true });
            });
          }
          return Promise.resolve(
            pageDataResponse("page-b", {
              pagePath: "page-b",
              params: { owner: "second" },
            }),
          );
        },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      const firstNavigation = runtime.navigateSPA("/same", "push");
      await flushUntil(() => runtime.fetchCalls.length === 1);
      const secondNavigation = runtime.navigateSPA("/same", "push");
      await Promise.all([firstNavigation, secondNavigation]);

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/same.json",
        "/_veryfront/page-data/same.json",
      ]);
      assertEquals(runtime.router.pathname, "/same");
      assertEquals(runtime.router.params, { owner: "second" });
      assertEquals(runtime.historyCalls, [{ method: "push", href: "/same" }]);
    });

    it("keeps current progress and fallback ownership when a stale request aborts", async () => {
      const secondResponse = deferred<unknown>();
      const runtime = evaluateRouterRuntime({
        fetchImpl: (url, options) => {
          if (url.endsWith("/first.json")) {
            return new Promise((_, reject) => {
              options.signal?.addEventListener("abort", () => {
                reject(new DOMException("Aborted", "AbortError"));
              });
            });
          }
          return secondResponse.promise;
        },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      const firstNavigation = runtime.navigateSPA("/first", "push");
      await flushUntil(() => runtime.fetchCalls.length === 1);
      const secondNavigation = runtime.navigateSPA("/second", "push");
      await flushUntil(() => runtime.fetchCalls.length === 2);
      await firstNavigation;

      assertEquals(runtime.isBodyBusy(), true);
      assertEquals(runtime.getAssignedHref(), null);

      secondResponse.resolve(
        pageDataResponse("page-b", { pagePath: "page-b", params: { owner: "second" } }),
      );
      await secondNavigation;

      assertEquals(runtime.router.pathname, "/second");
      assertEquals(runtime.getAssignedHref(), null);
      assertEquals(runtime.isBodyBusy(), false);
    });

    it("prevents a superseded delayed render from overwriting the latest page", async () => {
      const firstComponent = deferred<unknown>();
      const loadedPaths: string[] = [];
      const runtime = evaluateRouterRuntime({
        fetchImpl: (url) => {
          const first = url.endsWith("/first.json");
          return Promise.resolve(
            pageDataResponse(first ? "page-a" : "page-b", {
              pagePath: first ? "page-a" : "page-b",
              params: { owner: first ? "first" : "second" },
            }),
          );
        },
        loadComponentImpl: (path) => {
          loadedPaths.push(path);
          return path === "page-a" ? firstComponent.promise : Promise.resolve(() => null);
        },
      });
      runtime.win.__veryfrontHydrationComplete?.();

      const firstNavigation = runtime.navigateSPA("/first", "push");
      await flushUntil(() => loadedPaths.includes("page-a"));
      const secondNavigation = runtime.navigateSPA("/second", "push");
      await secondNavigation;

      firstComponent.resolve(() => null);
      await firstNavigation;

      assertEquals(runtime.router.pathname, "/second");
      assertEquals(runtime.getRenderedPageParams(), { owner: "second" });
      assertEquals(runtime.historyCalls, [{ method: "push", href: "/second" }]);
      assertEquals(runtime.getNavigationNotifications(), 1);
    });

    it("interrupts a stale hydration wait without cleaning up the current owner", async () => {
      const runtime = evaluateRouterRuntime();

      const firstNavigation = runtime.navigateSPA(
        "/first",
        "push",
        false,
        { pagePath: "page-a", params: { owner: "first" } },
      );
      await flushMicrotasks();
      await flushMicrotasks();

      const secondNavigation = runtime.navigateSPA(
        "/second",
        "push",
        false,
        { pagePath: "page-b", params: { owner: "second" } },
      );
      await firstNavigation;

      assertEquals(runtime.isBodyBusy(), true);
      assertEquals(runtime.historyCalls, []);

      runtime.win.__veryfrontHydrationComplete?.();
      await secondNavigation;

      assertEquals(runtime.router.pathname, "/second");
      assertEquals(runtime.historyCalls, [{ method: "push", href: "/second" }]);
      assertEquals(runtime.isBodyBusy(), false);
    });

    it("routes state-backed popstate through the same latest-navigation transaction", async () => {
      const firstResponse = deferred<unknown>();
      const runtime = evaluateRouterRuntime({
        fetchImpl: () => firstResponse.promise,
      });
      runtime.win.__veryfrontHydrationComplete?.();

      const firstNavigation = runtime.navigateSPA("/first", "push");
      await flushUntil(() => runtime.fetchCalls.length === 1);

      runtime.win.location.pathname = "/back";
      const popstate = runtime.listeners.popstate?.[0];
      if (!popstate) throw new Error("popstate handler was not registered");
      await popstate({
        state: {
          pageData: { pagePath: "page-back", params: { owner: "popstate" } },
        },
      });

      firstResponse.resolve(
        pageDataResponse("page-a", { pagePath: "page-a", params: { owner: "first" } }),
      );
      await firstNavigation;

      assertEquals(runtime.fetchCalls.length, 1);
      assertEquals(runtime.router.pathname, "/back");
      assertEquals(runtime.getRenderedPageParams(), { owner: "popstate" });
      assertEquals(runtime.historyCalls, []);
      assertEquals(runtime.getAssignedHref(), null);
    });

    it("preserves push, replace, and none history contracts", async () => {
      const runtime = evaluateRouterRuntime();
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA(
        "/pushed",
        "push",
        false,
        { pagePath: "page", params: {} },
      );
      await runtime.navigateSPA(
        "/replaced",
        "replace",
        false,
        { pagePath: "page", params: {} },
      );
      await runtime.navigateSPA(
        "/history-owned",
        "none",
        false,
        { pagePath: "page", params: {} },
      );

      assertEquals(runtime.historyCalls, [
        { method: "push", href: "/pushed" },
        { method: "replace", href: "/replaced" },
      ]);
      assertEquals(runtime.router.pathname, "/history-owned");
    });

    it("falls back to a document navigation only for the current owner", async () => {
      const originalConsoleError = console.error;
      console.error = () => {};
      try {
        const runtime = evaluateRouterRuntime();
        runtime.win.__veryfrontHydrationComplete?.();
        await runtime.navigateSPA(
          "/server-layout",
          "push",
          false,
          {
            pagePath: "page",
            params: {},
            requiresFullDocumentNavigation: true,
          },
        );

        assertEquals(runtime.getAssignedHref(), "/server-layout");
        assertEquals(runtime.isBodyBusy(), false);
      } finally {
        console.error = originalConsoleError;
      }
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

    it("keeps speculative module resolution scoped to the prefetched release", async () => {
      const releaseAssetModules = {
        "app/page.tsx": "/_vf/assets/" + "a".repeat(64) + ".js",
      };
      const runtime = evaluateRouterRuntime({
        activeReleaseId: "release-1",
        fetchImpl: () =>
          Promise.resolve(
            pageDataResponse("next", {
              pagePath: "app/page.tsx",
              params: {},
              isolatedClientPage: true,
              releaseId: "release-1",
              releaseAssetModules,
            }),
          ),
      });

      runtime.router.prefetch("/next");
      await flushUntil(() => runtime.moduleResolutionCalls.length === 1);

      assertEquals(runtime.moduleResolutionCalls, [{
        path: "app/page.tsx",
        preferRscModule: true,
        studioEmbed: false,
        releaseAssetModules,
        releaseId: "release-1",
      }]);
    });

    it("reloads when cached speculative data belongs to another build", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationBuildVersion: { framework: "1.0.0", serverStart: 1 },
        hydrationDev: true,
        fetchImpl: () =>
          Promise.resolve(
            pageDataResponse("stale", {
              pagePath: "page",
              params: {},
              buildVersion: { framework: "1.0.0", serverStart: 2 },
            }),
          ),
      });
      runtime.win.__veryfrontHydrationComplete?.();

      runtime.router.prefetch("/stale");
      await flushUntil(() => runtime.fetchCalls.length === 1);
      for (let index = 0; index < 10; index++) await flushMicrotasks();
      await runtime.navigateSPA("/stale", "push");

      assertEquals(runtime.getAssignedHref(), "/stale");
      assertEquals(runtime.historyCalls, []);
      assertEquals(runtime.router.pathname, "/");
      assertEquals(runtime.fetchCalls.length, 1);
    });

    it("does not treat a different healthy production pod start as a new build", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationBuildVersion: {
          framework: "1.0.0",
          serverStart: 1,
          projectUpdated: "2026-07-27T17:00:00.000Z",
        },
        hydrationDev: false,
        fetchImpl: () =>
          Promise.resolve(
            pageDataResponse("next", {
              pagePath: "page",
              params: {},
              buildVersion: {
                framework: "1.0.0",
                serverStart: 2,
                projectUpdated: "2026-07-27T17:00:00.000Z",
              },
            }),
          ),
      });
      runtime.win.__veryfrontHydrationComplete?.();

      await runtime.navigateSPA("/next", "push");

      assertEquals(runtime.getAssignedHref(), null);
      assertEquals(runtime.router.pathname, "/next");
      assertEquals(runtime.historyCalls, [{ method: "push", href: "/next" }]);
    });

    it("does not reload the active document for a speculative module snapshot conflict", async () => {
      const runtime = evaluateRouterRuntime({
        hydrationDependencyPinningCacheKey: "on:snapshot-a",
        importModuleImpl: () => Promise.reject(new Error("module import failed")),
        fetchImpl: (url) => {
          if (url.startsWith("/_veryfront/page-data/")) {
            return Promise.resolve({
              ok: true,
              status: 200,
              url,
              headers: { get: () => null },
              json: () =>
                Promise.resolve({
                  pagePath: "app/page.tsx",
                  params: {},
                  isolatedClientPage: true,
                  dependencyPinningCacheKey: "on:snapshot-a",
                }),
            });
          }

          return Promise.resolve(
            new Response("Unknown dependency snapshot", { status: 409 }),
          );
        },
      });

      runtime.router.prefetch("/target");
      await flushUntil(() => runtime.fetchCalls.length >= 2);

      assertEquals(runtime.fetchCalls.map((call) => call.url), [
        "/_veryfront/page-data/target.json",
        "/_veryfront/rsc/module?rel=app%2Fpage.tsx&pins=on%3Asnapshot-a",
      ]);
      assertEquals(runtime.getReloads(), 0);
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

        await runtime.navigateSPA("/target", "push");

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

    it("classifies an internal fetch deadline as a timeout, not navigation cancellation", async () => {
      let nextTimerId = 1;
      const timers = new Map<number, { callback: () => void; delay: number }>();
      const runtime = evaluateRouterRuntime({
        fetchImpl: (_url, options) =>
          new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            }, { once: true });
          }),
        setTimeoutImpl: (callback, delay) => {
          const id = nextTimerId++;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimeoutImpl: (id) => timers.delete(id),
      });

      const request = runtime.fetchWithRetry(
        "/_veryfront/page-data/slow.json",
        {},
        0,
      );
      await flushUntil(() => runtime.fetchCalls.length === 1);

      const deadline = [...timers.values()].find((timer) => timer.delay === 10_000);
      if (!deadline) throw new Error("fetch deadline was not scheduled");
      deadline.callback();

      let failure: unknown;
      try {
        await request;
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof Error, true);
      assertEquals((failure as Error).name, "TimeoutError");
    });

    it("cancels retry bodies and interrupts backoff when navigation is aborted", async () => {
      let nextTimerId = 1;
      let canceledBodies = 0;
      const timers = new Map<number, { callback: () => void; delay: number }>();
      const runtime = evaluateRouterRuntime({
        fetchImpl: () =>
          Promise.resolve({
            ok: false,
            status: 503,
            body: {
              cancel() {
                canceledBodies++;
                return Promise.resolve();
              },
            },
          }),
        setTimeoutImpl: (callback, delay) => {
          const id = nextTimerId++;
          timers.set(id, { callback, delay });
          return id;
        },
        clearTimeoutImpl: (id) => timers.delete(id),
      });
      const controller = new AbortController();

      const request = runtime.fetchWithRetry(
        "/_veryfront/page-data/retry.json",
        { signal: controller.signal },
        2,
      );
      await flushUntil(() => [...timers.values()].some((timer) => timer.delay === 500));
      controller.abort();

      let failure: unknown;
      try {
        await request;
      } catch (error) {
        failure = error;
      }

      assertEquals(failure instanceof Error, true);
      assertEquals((failure as Error).name, "AbortError");
      assertEquals(canceledBodies, 1);
      assertEquals(runtime.fetchCalls.length, 1);
      assertEquals(
        [...timers.values()].some((timer) => timer.delay === 500),
        false,
      );
    });
  });
});
