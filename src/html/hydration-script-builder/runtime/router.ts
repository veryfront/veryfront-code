/**
 * The SPA router: page-data fetching and caching, navigation, prefetching,
 * scroll memory, and re-rendering a route from its page data.
 */

import type {
  ClientRouter,
  HydrationRuntimeEnv,
  PageDataPayload,
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
  pageDataCacheIdentity as buildPageDataCacheIdentity,
} from "./module-urls.ts";

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
  documentDependencyPinningCacheKey: string | null | undefined;
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

interface PendingPageDataFetch {
  request: Promise<PageDataPayload>;
  signal: AbortSignal | null;
}

interface NavigationTransaction {
  id: number;
  controller: AbortController;
  signal: AbortSignal;
}

export function createRouterRuntime(deps: RouterRuntimeDeps): RouterRuntime {
  const { env, logging, routeTiming, componentLoader } = deps;
  const { window, document, React, RouterProvider, PageContextProvider } = env;
  // Shadow the globals so every timer in this module goes through the env.
  const { setTimeout, clearTimeout } = env;
  const { log, logError, logBackgroundFetchFailure, perfStart, perfEnd, perfCancel } = logging;
  const { emitRouteTiming, buildPageDataTimingDetail } = routeTiming;
  const { loadComponentFromUrl, resolveHydrationModuleUrl } = componentLoader;
  const documentPinKey = deps.documentDependencyPinningCacheKey;

  // ============================================
  // Hydration state tracking
  // ============================================
  let hydrationResolve!: () => void;
  const hydrationPromise = new Promise<void>((resolve) => {
    hydrationResolve = resolve;
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
    // Wake navigation waiters without rejecting an otherwise unobserved
    // promise. The render path reads hydrationFailed and performs fallback.
    hydrationResolve();
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
  function navigateDocument(target: string): void {
    const safeUrl = resolveDocumentNavigationUrl(target, window.location.origin);
    if (safeUrl) {
      window.location.href = safeUrl;
      return;
    }

    logError("Refusing an unsafe document navigation:", target);
    window.location.reload();
  }

  function navigateForDependencySnapshotMismatch(target: string): void {
    if (window.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__ === true) return;
    window.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__ = true;
    try {
      navigateDocument(target);
    } catch (error) {
      delete window.__VF_DEPENDENCY_SNAPSHOT_RECOVERY_STARTED__;
      throw error;
    }
  }

  function getNavigationUrl(href: string): URL {
    return new URL(href, window.location.href);
  }

  function getNavigationPathname(href: string): string {
    try {
      return getNavigationUrl(href).pathname;
    } catch (_) {
      return "<invalid route>";
    }
  }

  function createAbortError(message = "Operation aborted"): Error {
    const error = new Error(message);
    error.name = "AbortError";
    return error;
  }

  function createTimeoutError(message = "Operation timed out"): Error {
    const error = new Error(message);
    error.name = "TimeoutError";
    return error;
  }

  function throwIfAborted(signal: AbortSignal | null | undefined): void {
    if (signal?.aborted) throw createAbortError();
  }

  function waitForHydration(signal: AbortSignal | undefined, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeoutState: { id?: number } = {};

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (timeoutState.id !== undefined) clearTimeout(timeoutState.id);
      };
      const settle = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => settle(() => reject(createAbortError()));

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      timeoutState.id = setTimeout(
        () => settle(() => reject(createTimeoutError("Hydration timeout"))),
        timeoutMs,
      );
      hydrationPromise.then(() => settle(resolve));
    });
  }

  // ============================================
  // Version tracking for cache invalidation
  // ============================================
  const compareServerStart = deps.initialHydrationData.dev === true;
  let clientBuildVersion: BuildVersionLike | null = deps.initialHydrationData.buildVersion &&
      typeof deps.initialHydrationData.buildVersion === "object"
    ? { ...deps.initialHydrationData.buildVersion }
    : null;

  function getBuildVersionMismatch(
    newVersion: BuildVersionLike,
  ): { field: keyof BuildVersionLike; previousValue: unknown; nextValue: unknown } | null {
    if (!clientBuildVersion || !newVersion || typeof newVersion !== "object") return null;

    const identityFields: Array<keyof BuildVersionLike> = compareServerStart
      ? ["serverStart", "framework", "projectUpdated"]
      : ["framework", "projectUpdated"];
    for (const field of identityFields) {
      const previousValue = clientBuildVersion[field];
      const nextValue = newVersion[field];
      if (
        previousValue !== undefined && nextValue !== undefined &&
        previousValue !== nextValue
      ) {
        return { field, previousValue, nextValue };
      }
    }
    return null;
  }

  function checkVersionMismatch(newVersion: BuildVersionLike): boolean {
    if (!clientBuildVersion) {
      clientBuildVersion = { ...newVersion };
      log("Build version initialized:", newVersion);
      return false;
    }

    const mismatch = getBuildVersionMismatch(newVersion);
    if (mismatch) {
      log("Build version changed, reloading...", mismatch);
      return true;
    }

    clientBuildVersion = { ...clientBuildVersion, ...newVersion };
    return false;
  }

  // ============================================
  // LRU cache with TTL (single Map to prevent sync issues)
  // ============================================
  const pageDataCache = new Map<string, { data: PageDataPayload; timestamp: number }>();
  const pendingPageDataFetches = new Map<string, PendingPageDataFetch>();
  const backgroundRefreshTimestamps = new Map<string, number>();

  function getCachedPageData(path: string): PageDataPayload | null {
    const cacheIdentity = pageDataCacheIdentity(path);
    const entry = pageDataCache.get(cacheIdentity);
    if (!entry) return null;

    if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
      pageDataCache.delete(cacheIdentity);
      pageDataCache.set(cacheIdentity, entry);
      return entry.data;
    }

    pageDataCache.delete(cacheIdentity);
    backgroundRefreshTimestamps.delete(cacheIdentity);
    return null;
  }

  function setCachedPageData(path: string, data: PageDataPayload): void {
    const cacheIdentity = pageDataCacheIdentity(path);
    if (pageDataCache.size >= MAX_CACHE_SIZE && !pageDataCache.has(cacheIdentity)) {
      const oldest = pageDataCache.keys().next().value;
      if (oldest) {
        pageDataCache.delete(oldest);
        backgroundRefreshTimestamps.delete(oldest);
      }
    }

    pageDataCache.delete(cacheIdentity);
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

  function restoreScrollPosition(path: string, navigation?: NavigationTransaction): boolean {
    const savedY = scrollPositions.get(path);
    if (savedY === undefined) return false;

    requestAnimationFrame(() => {
      if (navigation && !isLatestNavigation(navigation)) return;
      window.scrollTo(0, savedY);
    });
    return true;
  }

  // ============================================
  // Loading progress indicator
  // ============================================
  let progressBar: RuntimeElement | null = null;
  let progressTimeout: number | null = null;
  let progressOwner = 0;

  function showNavigationProgress(navigationId: number): void {
    progressOwner = navigationId;
    if (progressTimeout) clearTimeout(progressTimeout);
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
      if (progressOwner !== navigationId) return;
      if (progressBar?.style) progressBar.style.width = "70%";
    }, 300);

    document.body.setAttribute("aria-busy", "true");
  }

  function hideNavigationProgress(navigationId: number): void {
    if (progressOwner !== navigationId) return;
    if (progressTimeout) {
      clearTimeout(progressTimeout);
      progressTimeout = null;
    }

    if (progressBar) {
      progressBar.style.width = "100%";
      setTimeout(() => {
        if (progressOwner !== navigationId) return;
        if (!progressBar) return;

        progressBar.style.opacity = "0";
        setTimeout(() => {
          if (progressOwner !== navigationId) return;
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

  function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutState: { id?: number } = {};
      const cleanup = () => signal?.removeEventListener("abort", onAbort);
      const onAbort = () => {
        if (timeoutState.id !== undefined) clearTimeout(timeoutState.id);
        cleanup();
        reject(createAbortError());
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }

      signal?.addEventListener("abort", onAbort, { once: true });
      timeoutState.id = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);
    });
  }

  function cancelResponseBody(response: RuntimeResponse | undefined): void {
    try {
      const cancellation = response?.body?.cancel?.();
      if (cancellation instanceof Promise) cancellation.catch(() => {});
    } catch (_) {
      // Releasing a retry response body is best-effort.
    }
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
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, FETCH_TIMEOUT_MS);
      let response: RuntimeResponse | undefined;
      let fetchError: unknown;
      try {
        response = await env.fetch(url, { ...options, signal: controller.signal });
      } catch (error) {
        fetchError = error;
      } finally {
        clearTimeout(timeout);
        callerSignal?.removeEventListener("abort", abortFromCaller);
      }

      if (callerSignal?.aborted) {
        cancelResponseBody(response);
        throw createAbortError();
      }

      if (response) {
        if (response.ok) return response;
        if (response.status < 500 || attempt === maxRetries) return response;

        cancelResponseBody(response);
        log("Server error, retrying...", response.status);
      } else {
        const failure = timedOut
          ? createTimeoutError("Page data request timed out")
          : isAbortError(fetchError)
          ? new Error("Page data request aborted unexpectedly")
          : fetchError ?? new Error("Page data request failed without a response");
        if (attempt === maxRetries) throw failure;
        log("Fetch failed, retrying...", (failure as Error).message ?? String(failure));
      }

      await sleep(Math.pow(2, attempt) * 500, callerSignal);
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
    const routePathname = getNavigationPathname(path);
    const endpoint = buildPageDataEndpoint(path, window.location.origin);
    const startedAt = recordRouteTiming ? routeTimingNow() : 0;

    log("Fetching page data:", routePathname);
    perfStart("fetch:" + routePathname);

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
    throwIfAborted(signal);

    if (!response.ok) {
      perfEnd("fetch:" + routePathname);
      if (recordRouteTiming) {
        emitRouteTiming(
          "page-data",
          routePathname,
          startedAt,
          buildPageDataTimingDetail(response, endpoint, startedAt, timingSource),
        );
      }
      const error = new Error("Failed to fetch page data: " + response.status) as Error & {
        status?: number;
        dependencySnapshotMismatch?: boolean;
      };
      error.status = response.status;
      if (response.status === 409 && typeof documentPinKey === "string") {
        error.dependencySnapshotMismatch = true;
      }
      throw error;
    }

    perfStart("parse:" + routePathname);
    const data = assertPageDataMatchesDocumentSnapshot(
      path,
      await response.json() as PageDataPayload,
      documentPinKey,
    );
    throwIfAborted(signal);
    perfEnd("parse:" + routePathname);
    perfEnd("fetch:" + routePathname);
    if (recordRouteTiming) {
      emitRouteTiming(
        "page-data",
        routePathname,
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
  ): PageDataPayload {
    const buildVersionChanged = data.buildVersion && checkVersionMismatch(data.buildVersion);
    const activeReleaseId = window.__veryfrontReleaseId;
    const releaseChanged = typeof activeReleaseId === "string" && activeReleaseId.length > 0 &&
      typeof data.releaseId === "string" && data.releaseId.length > 0 &&
      data.releaseId !== activeReleaseId;

    if (buildVersionChanged || releaseChanged) {
      log(
        "Version mismatch detected, performing full page reload to:",
        getNavigationPathname(path),
      );
      navigateDocument(path);
      throw createAbortError("Page data belongs to a different build");
    }

    return data;
  }

  function startPageDataFetch(
    path: string,
    signal: AbortSignal | null,
    options: PageDataFetchOptions = {},
  ): Promise<PageDataPayload> {
    const cacheIdentity = pageDataCacheIdentity(path);
    let pendingEntry: PendingPageDataFetch | undefined;
    const request = fetchPageDataFresh(path, signal, options).finally(() => {
      if (
        options.trackPending !== false &&
        pendingPageDataFetches.get(cacheIdentity) === pendingEntry
      ) {
        pendingPageDataFetches.delete(cacheIdentity);
      }
    });
    if (options.trackPending !== false) {
      pendingEntry = { request, signal };
      pendingPageDataFetches.set(cacheIdentity, pendingEntry);
    }
    return request;
  }

  function getPendingPageDataRequest(
    path: string,
    callerSignal: AbortSignal | null,
  ): Promise<PageDataPayload> | null {
    const cacheIdentity = pageDataCacheIdentity(path);
    const pendingEntry = pendingPageDataFetches.get(cacheIdentity);
    if (!pendingEntry) return null;
    if (pendingEntry.signal?.aborted) {
      pendingPageDataFetches.delete(cacheIdentity);
      return null;
    }
    if (pendingEntry.signal && pendingEntry.signal !== callerSignal) return null;
    return pendingEntry.request;
  }

  function invalidatePendingPageDataFetchesForSignal(signal: AbortSignal): void {
    for (const [cacheIdentity, pendingEntry] of pendingPageDataFetches) {
      if (pendingEntry.signal === signal) pendingPageDataFetches.delete(cacheIdentity);
    }
  }

  function fetchPageDataDeduped(path: string): Promise<PageDataPayload> {
    const pending = getPendingPageDataRequest(path, null);
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
      log("Using cached page data:", getNavigationPathname(path));
      const checkedData = handlePageDataVersionMismatch(path, cached);
      refreshPageDataInBackground(path);
      emitRouteTiming("page-data", getNavigationPathname(path), startedAt, { source: "cache" });
      return checkedData;
    }

    const pending = getPendingPageDataRequest(path, signal);
    if (pending) {
      log("Reusing pending page data fetch for navigation:", path);
      const data = await pending;
      throwIfAborted(signal);
      emitRouteTiming("page-data", getNavigationPathname(path), startedAt, { source: "deduped" });
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
  let currentPath = window.location.pathname + window.location.search;
  let currentHash = window.location.hash || "";
  let isNavigating = false;
  let navigationSequence = 0;

  function isLatestNavigation(navigation: NavigationTransaction): boolean {
    return navigation.id === navigationSequence && !navigation.signal.aborted;
  }

  function assertLatestNavigation(navigation?: NavigationTransaction): void {
    if (navigation && !isLatestNavigation(navigation)) {
      throw createAbortError("Navigation superseded");
    }
  }

  function notifyNavigationSubscribers(): void {
    try {
      deps.getNavigationStore().notify();
    } catch (error) {
      log("Navigation subscriber notification failed:", (error as Error).message);
    }
  }

  // ============================================
  // SPA navigation handler
  // ============================================
  async function navigateSPA(
    href: string,
    historyMode: HistoryMode = "push",
    restoreScroll = false,
    providedPageData?: PageDataPayload,
  ): Promise<void> {
    let targetUrl: URL;
    try {
      targetUrl = getNavigationUrl(href);
    } catch (_) {
      logError("Invalid SPA navigation target");
      return;
    }

    if (targetUrl.origin !== window.location.origin) {
      navigateDocument(targetUrl.href);
      return;
    }

    const targetRouteHref = targetUrl.pathname + targetUrl.search;
    const resolvedHref = targetRouteHref + targetUrl.hash;
    const targetPathname = targetUrl.pathname;
    const targetHash = targetUrl.hash ? targetUrl.hash.slice(1) : "";
    const navigationId = ++navigationSequence;
    const supersededController = currentAbortController;
    supersededController?.abort();
    if (supersededController) {
      invalidatePendingPageDataFetchesForSignal(supersededController.signal);
    }

    removeQueuedPrefetch(targetRouteHref);
    abortActiveSpeculativePrefetches();

    const controller = new AbortController();
    currentAbortController = controller;
    const signal = controller.signal;
    const navigation: NavigationTransaction = { id: navigationId, controller, signal };
    isNavigating = true;
    const navigationStartedAt = routeTimingNow();
    const totalPerfLabel = "nav:total:" + navigationId + ":" + targetPathname;
    const fetchPerfLabel = "nav:fetchData:" + navigationId + ":" + targetPathname;
    const renderPerfLabel = "nav:render:" + navigationId + ":" + targetPathname;

    try {
      showNavigationProgress(navigationId);
      perfStart(totalPerfLabel);
      log("SPA navigating to:", targetPathname);

      saveScrollPosition(currentPath);

      perfStart(fetchPerfLabel);
      const pageData = providedPageData === undefined
        ? await fetchPageDataForNavigation(targetRouteHref, signal)
        : handlePageDataVersionMismatch(
          targetRouteHref,
          assertPageDataMatchesDocumentSnapshot(
            targetRouteHref,
            providedPageData,
            documentPinKey,
          ),
        );
      assertLatestNavigation(navigation);
      perfEnd(fetchPerfLabel);

      // getServerData redirect(): the page-data endpoint encodes it as a 200
      // { redirect: { destination } } payload. Follow it with a document
      // navigation to the target (the same net effect as the full-page 302),
      // instead of trying to render a page that does not exist here. An unsafe
      // or unparseable destination falls through to the normal error path
      // rather than reloading, which is what it did before the scheme check
      // moved into resolveDocumentNavigationUrl.
      if (pageData && pageData.redirect && typeof pageData.redirect.destination === "string") {
        const redirectUrl = resolveDocumentNavigationUrl(
          pageData.redirect.destination,
          window.location.origin,
        );
        if (redirectUrl) {
          assertLatestNavigation(navigation);
          log("SPA navigation redirect -> " + redirectUrl);
          window.location.href = redirectUrl;
          return;
        }
      }

      perfStart(renderPerfLabel);
      await renderPageFromData(pageData, targetPathname, navigation, () => {
        assertLatestNavigation(navigation);

        if (historyMode === "push") {
          window.history.pushState({ pageData, scrollY: 0 }, "", resolvedHref);
        } else if (historyMode === "replace") {
          window.history.replaceState({ pageData, scrollY: 0 }, "", resolvedHref);
        }

        currentPath = targetRouteHref;
        currentHash = targetUrl.hash;
        router.path = targetPathname;
        router.pathname = targetPathname;
        router.query = Object.fromEntries(targetUrl.searchParams);
        router.params = normalizeRouteParams(pageData.params);
        window.__veryfrontSetReleaseId?.(pageData.releaseId || null);
        window.__veryfrontSetReleaseAssetModules?.(pageData.releaseAssetModules || null);
      });
      assertLatestNavigation(navigation);
      perfEnd(renderPerfLabel);
      notifyNavigationSubscribers();

      if (restoreScroll) {
        restoreScrollPosition(targetRouteHref, navigation);
      } else if (targetHash) {
        requestAnimationFrame(() => {
          if (!isLatestNavigation(navigation)) return;
          const target = document.getElementById(targetHash);
          if (target) {
            target.scrollIntoView({ behavior: "smooth" });
            return;
          }
          window.scrollTo(0, 0);
        });
      } else {
        assertLatestNavigation(navigation);
        window.scrollTo(0, 0);
      }

      assertLatestNavigation(navigation);
      perfEnd(totalPerfLabel);
      emitRouteTiming("total", targetPathname, navigationStartedAt, {
        href: resolvedHref,
        historyMode,
        restoreScroll,
      });
      log("SPA navigation complete");
    } catch (error) {
      if (!isLatestNavigation(navigation) || isAbortError(error)) {
        log("Navigation aborted");
        return;
      }

      logError("SPA navigation failed:", (error as Error).message);

      if ((error as { status?: number }).status === 404) {
        logError("Page not found:", targetPathname);
      }

      if ((error as { dependencySnapshotMismatch?: boolean }).dependencySnapshotMismatch) {
        navigateForDependencySnapshotMismatch(resolvedHref);
      } else {
        navigateDocument(resolvedHref);
      }
    } finally {
      perfCancel(totalPerfLabel);
      perfCancel(fetchPerfLabel);
      perfCancel(renderPerfLabel);
      if (navigationId === navigationSequence && currentAbortController === controller) {
        hideNavigationProgress(navigationId);
        isNavigating = false;
        currentAbortController = null;
        processPageDataPrefetchQueue();
      }
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
    const moduleUrl = resolveHydrationModuleUrl(
      path,
      pageData.isolatedClientPage === true,
      window.__veryfrontStudioEmbed === true,
      pageData,
      pageData.releaseAssetModules || null,
      pageData.releaseId || null,
    );
    const component = await loadComponentFromUrl(
      path,
      moduleUrl,
      options,
    );
    if (!component) throw new Error("Module has no renderable export: " + path);
    return component;
  }

  async function renderPageFromData(
    pageData: PageDataPayload,
    targetPath: string,
    navigation?: NavigationTransaction,
    commitNavigationState?: () => void,
  ): Promise<void> {
    assertLatestNavigation(navigation);
    if (pageData.requiresFullDocumentNavigation) {
      throw new Error("Server layout requires full document navigation");
    }

    perfStart("render:loadAll");
    const allPaths = getPageDataModulePaths(pageData);
    const modulesStartedAt = routeTimingNow();
    const components = await Promise.all(
      allPaths.map((path) => loadPageDataComponent(pageData, path)),
    );
    assertLatestNavigation(navigation);
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

    if (!hydrationCompleted && !hydrationFailed) {
      log("Waiting for hydration to complete before SPA render...");
      try {
        await waitForHydration(navigation?.signal, 10000);
      } catch (waitError) {
        if (isAbortError(waitError)) throw waitError;
        log("Hydration wait failed:", (waitError as Error).message);
      }
    }

    assertLatestNavigation(navigation);
    if (commitNavigationState) {
      commitNavigationState();
    } else {
      window.__veryfrontSetReleaseId?.(pageData.releaseId || null);
      window.__veryfrontSetReleaseAssetModules?.(pageData.releaseAssetModules || null);
    }

    if (pageData.frontmatter?.title) {
      document.title = pageData.frontmatter.title as string;
    }

    if (pageData.frontmatter?.description) {
      const metaDesc = document.querySelector('meta[name="description"]');
      metaDesc?.setAttribute("content", pageData.frontmatter.description as string);
    }

    if (typeof pageData.css === "string") {
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
      query: { ...router.query },
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

    assertLatestNavigation(navigation);
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
    if (pageData.buildVersion && getBuildVersionMismatch(pageData.buildVersion)) return;
    const activeReleaseId = window.__veryfrontReleaseId;
    if (
      typeof activeReleaseId === "string" && activeReleaseId.length > 0 &&
      typeof pageData.releaseId === "string" && pageData.releaseId.length > 0 &&
      pageData.releaseId !== activeReleaseId
    ) {
      return;
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
          entry.target as unknown as RuntimeElement,
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
      observer.observe(link as unknown as Element);
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
    const navigationStore = deps.getNavigationStore();
    window.__veryfrontNavigationStoreDisposer?.();
    const navigationStoreDisposer = navigationStore.setNavigator((href, options) => {
      const mode = options && options.history;
      const historyMode: HistoryMode = mode === "replace"
        ? "replace"
        : mode === "none"
        ? "none"
        : "push";
      return navigateSPA(href, historyMode);
    });
    window.__veryfrontNavigationStoreDisposer = typeof navigationStoreDisposer === "function"
      ? navigationStoreDisposer
      : null;
  }

  // ============================================
  // Event handlers
  // ============================================
  window.addEventListener("popstate", async (e: RuntimeEvent) => {
    const routeHref = window.location.pathname + window.location.search;
    const nextHash = window.location.hash || "";
    if (routeHref === currentPath && nextHash !== currentHash) {
      currentHash = nextHash;
      notifyNavigationSubscribers();
      return;
    }

    const href = routeHref + nextHash;
    log("Popstate:", window.location.pathname);
    await navigateSPA(href, "none", true, e.state?.pageData);
  });

  window.addEventListener("hashchange", () => {
    const nextHash = window.location.hash || "";
    if (nextHash === currentHash) return;
    currentHash = nextHash;
    notifyNavigationSubscribers();
  });

  document.addEventListener("click", (e: RuntimeEvent) => {
    if (e.defaultPrevented || (typeof e.button === "number" && e.button !== 0)) return;
    if (!e.target || typeof e.target.closest !== "function") return;
    const link = e.target.closest("a[href]");
    if (!link) return;

    const href = link.getAttribute("href");
    if (!href) return;

    if (href.startsWith("#")) {
      let targetId = href.slice(1);
      try {
        targetId = decodeURIComponent(targetId);
      } catch (_) {
        // Keep the literal fragment when it is not valid percent encoding.
      }
      const target = document.getElementById(targetId);
      if (!target) return;

      e.preventDefault();
      window.history.pushState(window.history.state, "", href);
      currentHash = window.location.hash || href;
      notifyNavigationSubscribers();
      target.scrollIntoView({ behavior: "smooth" });
      return;
    }

    if (
      (link.target && link.target !== "_self") ||
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
