export const getRouterScript = () => `
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    // ============================================
    // Hydration state tracking
    // ============================================
    let hydrationResolve;
    const hydrationPromise = new Promise((resolve) => {
      hydrationResolve = resolve;
    });
    let hydrationCompleted = false;
    let hydrationFailed = false;

    window.__veryfrontHydrationComplete = () => {
      hydrationCompleted = true;
      hydrationResolve();
      log('Hydration complete signal received');
    };

    window.__veryfrontHydrationFailed = (error) => {
      hydrationFailed = true;
      // Wake navigation waiters without rejecting an otherwise unobserved
      // promise. The render path reads hydrationFailed and performs the
      // document-navigation fallback.
      hydrationResolve();
      logError('Hydration failed signal received:', error);
    };

    // ============================================
    // Configuration
    // ============================================
    const DEBUG = window.__VERYFRONT_DEBUG__ || new URLSearchParams(window.location.search).has('vf_debug');
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
    const VIEWPORT_PREFETCH_ROOT_MARGIN = '200px';
    const MAX_ROUTE_TIMINGS = 100;
    const MAX_SERVER_TIMING_LENGTH = 1024;

    // ============================================
    // Debug logging (production-safe)
    // ============================================
    const log = DEBUG ? console.log.bind(console, '[Veryfront]') : () => {};
    const logError = console.error.bind(console, '[Veryfront]');

    function getNavigationUrl(href) {
      return new URL(href, window.location.href);
    }

    function getNavigationPathname(href) {
      try {
        return getNavigationUrl(href).pathname;
      } catch (_) {
        return '<invalid route>';
      }
    }

    function logBackgroundFetchFailure(reason, path, error) {
      const message = error?.message ?? String(error);
      log(reason + ' failed:', getNavigationPathname(path), message);
    }

    function isAbortError(error) {
      return error?.name === 'AbortError';
    }

    function createAbortError(message = 'Operation aborted') {
      const error = new Error(message);
      error.name = 'AbortError';
      return error;
    }

    function createTimeoutError(message = 'Operation timed out') {
      const error = new Error(message);
      error.name = 'TimeoutError';
      return error;
    }

    function throwIfAborted(signal) {
      if (signal?.aborted) throw createAbortError();
    }

    function waitForHydration(signal, timeoutMs) {
      return new Promise((resolve, reject) => {
        let settled = false;
        let timeout;

        const cleanup = () => {
          signal?.removeEventListener('abort', onAbort);
          if (timeout !== undefined) clearTimeout(timeout);
        };
        const settle = (callback, value) => {
          if (settled) return;
          settled = true;
          cleanup();
          callback(value);
        };
        const onAbort = () => settle(reject, createAbortError());

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        timeout = setTimeout(
          () => settle(reject, createTimeoutError('Hydration timeout')),
          timeoutMs,
        );
        hydrationPromise.then(() => settle(resolve));
      });
    }

    function getDocumentNonce() {
      const element = document.querySelector('script[nonce], style[nonce], link[nonce]');
      if (!element) return undefined;

      return element.nonce || element.getAttribute('nonce') || undefined;
    }

    // ============================================
    // Version tracking for cache invalidation
    // ============================================
    let compareServerStart = false;

    function readInitialBuildVersion() {
      try {
        const element = document.getElementById('veryfront-hydration-data');
        const data = JSON.parse(element?.textContent || '{}');
        // Process start time is useful for a local dev server restart, but it is
        // not a deployment identity: healthy production pods naturally start
        // at different times. Production uses framework, project, and release
        // identities so load balancing cannot cause reload loops.
        compareServerStart = data?.dev === true;
        return data?.buildVersion && typeof data.buildVersion === 'object'
          ? { ...data.buildVersion }
          : null;
      } catch (_) {
        return null;
      }
    }

    let clientBuildVersion = readInitialBuildVersion();

    function getBuildVersionMismatch(newVersion) {
      if (!clientBuildVersion || !newVersion || typeof newVersion !== 'object') {
        return null;
      }

      const identityFields = compareServerStart
        ? ['serverStart', 'framework', 'projectUpdated']
        : ['framework', 'projectUpdated'];
      for (const field of identityFields) {
        const previousValue = clientBuildVersion[field];
        const nextValue = newVersion[field];
        if (
          previousValue !== undefined &&
          nextValue !== undefined &&
          previousValue !== nextValue
        ) {
          return { field, previousValue, nextValue };
        }
      }

      return null;
    }

    function checkVersionMismatch(newVersion) {
      if (!clientBuildVersion) {
        clientBuildVersion = { ...newVersion };
        log('Build version initialized:', newVersion);
        return false;
      }

      const mismatch = getBuildVersionMismatch(newVersion);
      if (mismatch) {
        log('Build version changed, reloading...', mismatch);
        return true;
      }

      // Hydration data may not carry optional project identity fields. Capture
      // them from the first page-data response so later navigations can still
      // detect a change.
      clientBuildVersion = { ...clientBuildVersion, ...newVersion };
      return false;
    }

    // ============================================
    // Performance timing (DEBUG only)
    // ============================================
    const perfTimers = new Map();
    const perfStart = DEBUG
      ? (label) => {
          perfTimers.set(label, performance.now());
        }
      : () => {};
    const perfEnd = DEBUG
      ? (label) => {
          const start = perfTimers.get(label);
          if (!start) return 0;

          const duration = performance.now() - start;
          perfTimers.delete(label);
          console.log(
            '[Veryfront Perf] %c' + label + ': %c' + duration.toFixed(2) + 'ms',
            'color: #888',
            duration > 100 ? 'color: #f00; font-weight: bold' : 'color: #0a0'
          );
          return duration;
        }
      : () => 0;
    const perfCancel = DEBUG
      ? (label) => {
          perfTimers.delete(label);
        }
      : () => {};

    function routeTimingNow() {
      return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    }

    function emitRouteTiming(phase, path, startedAt, detail = {}) {
      const entry = {
        phase,
        path,
        duration: Math.max(0, routeTimingNow() - startedAt),
        timestamp: Date.now(),
        ...detail
      };
      const timings = Array.isArray(window.__veryfrontRouteTimings)
        ? window.__veryfrontRouteTimings
        : [];

      timings.push(entry);
      if (timings.length > MAX_ROUTE_TIMINGS) {
        timings.splice(0, timings.length - MAX_ROUTE_TIMINGS);
      }

      window.__veryfrontRouteTimings = timings;

      try {
        window.dispatchEvent(new CustomEvent('veryfront:route-timing', { detail: entry }));
      } catch (_) {
        // CustomEvent dispatch is best-effort instrumentation.
      }

      log('Route timing:', entry);
      return entry;
    }

    function sanitizeServerTimingHeader(value) {
      if (!value) return null;

      const metrics = [];
      const printable = String(value).replace(/[^\\x20-\\x7E]/g, ' ').trim();
      if (!printable) return null;

      for (const item of printable.split(',')) {
        const segments = item.split(';').map((segment) => segment.trim()).filter(Boolean);
        const name = sanitizeServerTimingMetricName(segments[0]);
        if (!name) continue;

        for (const segment of segments.slice(1)) {
          const [key, rawValue = ''] = segment.split('=');
          if (key.trim().toLowerCase() !== 'dur') continue;

          const duration = Number(rawValue.trim().replace(/^"|"$/g, ''));
          if (!Number.isFinite(duration) || duration < 0) continue;

          metrics.push(name + ';dur=' + (Math.round(duration * 100) / 100).toFixed(2));
          break;
        }
      }

      const sanitized = metrics.join(', ');
      return sanitized ? sanitized.slice(0, MAX_SERVER_TIMING_LENGTH) : null;
    }

    function sanitizeServerTimingMetricName(name) {
      return String(name || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
    }

    function parseServerTimingMetrics(value) {
      const header = sanitizeServerTimingHeader(value);
      if (!header) return null;

      const metrics = {};
      for (const item of header.split(',')) {
        const segments = item.split(';').map((segment) => segment.trim()).filter(Boolean);
        const name = sanitizeServerTimingMetricName(segments[0]);
        if (!name) continue;

        for (const segment of segments.slice(1)) {
          const [key, rawValue = ''] = segment.split('=');
          if (key.trim().toLowerCase() !== 'dur') continue;

          const duration = Number(rawValue.trim().replace(/^"|"$/g, ''));
          if (Number.isFinite(duration) && duration >= 0) {
            metrics[name] = Math.round(duration * 100) / 100;
          }
        }
      }

      return Object.keys(metrics).length ? metrics : null;
    }

    function readResponseServerTiming(response) {
      try {
        return sanitizeServerTimingHeader(response.headers?.get('server-timing'));
      } catch (_) {
        return null;
      }
    }

    function roundRouteTimingValue(value) {
      return Math.round(value * 100) / 100;
    }

    function extractResourceTiming(entry) {
      const fields = [
        'startTime',
        'requestStart',
        'responseStart',
        'responseEnd',
        'duration',
        'transferSize',
        'encodedBodySize',
        'decodedBodySize'
      ];
      const timing = {};

      for (const field of fields) {
        const value = entry?.[field];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          timing[field] = roundRouteTimingValue(value);
        }
      }

      return Object.keys(timing).length ? timing : null;
    }

    function getPageDataResourceTiming(endpoint, fetchStartedAt) {
      try {
        if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') {
          return null;
        }

        const href = new URL(endpoint, window.location.href).href;
        const entries = performance.getEntriesByName(href, 'resource');
        if (!entries.length) return null;

        for (let index = entries.length - 1; index >= 0; index--) {
          const entry = entries[index];
          if (
            typeof entry?.responseEnd === 'number' &&
            Number.isFinite(entry.responseEnd) &&
            entry.responseEnd + 1 >= fetchStartedAt
          ) {
            return extractResourceTiming(entry);
          }
        }

        return null;
      } catch (_) {
        return null;
      }
    }

    function buildPageDataTimingDetail(response, endpoint, fetchStartedAt, source) {
      const detail = { source, status: response.status };
      const serverTiming = readResponseServerTiming(response);
      if (serverTiming) {
        detail.serverTiming = serverTiming;
        const serverTimingMetrics = parseServerTimingMetrics(serverTiming);
        if (serverTimingMetrics) detail.serverTimingMetrics = serverTimingMetrics;
      }

      const resourceTiming = getPageDataResourceTiming(response.url || endpoint, fetchStartedAt);
      if (resourceTiming) detail.resourceTiming = resourceTiming;

      return detail;
    }

    // ============================================
    // LRU Cache with TTL (single Map to prevent sync issues)
    // ============================================
    const pageDataCache = new Map();
    const pendingPageDataFetches = new Map();
    const backgroundRefreshTimestamps = new Map();

    function getCachedPageData(path) {
      const entry = pageDataCache.get(path);
      if (!entry) return null;

      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        pageDataCache.delete(path);
        pageDataCache.set(path, entry);
        return entry.data;
      }

      pageDataCache.delete(path);
      backgroundRefreshTimestamps.delete(path);
      return null;
    }

    function setCachedPageData(path, data) {
      if (pageDataCache.size >= MAX_CACHE_SIZE && !pageDataCache.has(path)) {
        const oldest = pageDataCache.keys().next().value;
        if (oldest) {
          pageDataCache.delete(oldest);
          backgroundRefreshTimestamps.delete(oldest);
        }
      }

      pageDataCache.delete(path);
      pageDataCache.set(path, { data, timestamp: Date.now() });
    }

    // ============================================
    // Scroll position memory (bounded)
    // ============================================
    const MAX_SCROLL_POSITIONS = 100;
    const scrollPositions = new Map();

    function saveScrollPosition(path) {
      if (scrollPositions.size >= MAX_SCROLL_POSITIONS) {
        const oldest = scrollPositions.keys().next().value;
        if (oldest) scrollPositions.delete(oldest);
      }
      scrollPositions.set(path, window.scrollY);
    }

    function restoreScrollPosition(path, navigation) {
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
    let progressBar = null;
    let progressTimeout = null;
    let progressOwner = 0;

    function showNavigationProgress(navigationId) {
      progressOwner = navigationId;
      if (progressTimeout) clearTimeout(progressTimeout);

      if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.id = 'vf-nav-progress';
        progressBar.style.cssText =
          'position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#0066ff,#00aaff);z-index:99999;transition:width 0.3s ease-out,opacity 0.2s;opacity:1;';
        document.body.prepend(progressBar);
      }

      progressBar.style.opacity = '1';
      progressBar.style.width = '30%';

      progressTimeout = setTimeout(() => {
        if (progressOwner !== navigationId) return;
        progressBar?.style && (progressBar.style.width = '70%');
      }, 300);

      document.body.setAttribute('aria-busy', 'true');
    }

    function hideNavigationProgress(navigationId) {
      if (progressOwner !== navigationId) return;

      if (progressTimeout) {
        clearTimeout(progressTimeout);
        progressTimeout = null;
      }

      if (progressBar) {
        progressBar.style.width = '100%';
        setTimeout(() => {
          if (progressOwner !== navigationId) return;
          if (!progressBar) return;

          progressBar.style.opacity = '0';
          setTimeout(() => {
            if (progressOwner !== navigationId) return;
            if (progressBar) progressBar.style.width = '0';
          }, 200);
        }, 150);
      }

      document.body.removeAttribute('aria-busy');
    }

    // ============================================
    // Fetch with timeout, retry, and abort support
    // ============================================
    let currentAbortController = null;

    function sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        let timeout;
        const cleanup = () => signal?.removeEventListener('abort', onAbort);
        const onAbort = () => {
          if (timeout !== undefined) clearTimeout(timeout);
          cleanup();
          reject(createAbortError());
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
        timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, ms);
      });
    }

    function cancelResponseBody(response) {
      try {
        const cancellation = response?.body?.cancel?.();
        cancellation?.catch?.(() => {});
      } catch (_) {
        // Releasing a retry response body is best-effort.
      }
    }

    async function fetchWithRetry(url, options, maxRetries = MAX_RETRIES) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const callerSignal = options.signal;
        const abortFromCaller = () => controller.abort();
        if (callerSignal?.aborted) controller.abort();
        callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
        let timedOut = false;
        const timeout = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, FETCH_TIMEOUT_MS);
        let response;
        let fetchError;
        try {
          response = await fetch(url, { ...options, signal: controller.signal });
        } catch (error) {
          fetchError = error;
        } finally {
          clearTimeout(timeout);
          callerSignal?.removeEventListener('abort', abortFromCaller);
        }

        if (callerSignal?.aborted) {
          cancelResponseBody(response);
          throw createAbortError();
        }

        if (response) {
          if (response.ok) return response;

          if (response.status < 500 || attempt === maxRetries) return response;

          cancelResponseBody(response);
          log('Server error, retrying...', response.status);
        } else {
          const failure = timedOut
            ? createTimeoutError('Page data request timed out')
            : isAbortError(fetchError)
            ? new Error('Page data request aborted unexpectedly')
            : fetchError ?? new Error('Page data request failed without a response');
          if (attempt === maxRetries) throw failure;

          log(
            'Fetch failed, retrying...',
            failure?.message ?? String(failure),
          );
        }

        await sleep(Math.pow(2, attempt) * 500, callerSignal);
      }
    }

    // ============================================
    // Page data fetching with caching
    // ============================================
    async function fetchPageDataFresh(path, signal, options = {}) {
      const {
        triggerReloadOnVersionMismatch = false,
        recordRouteTiming = false,
        timingSource = 'network'
      } = options;
      const navigationUrl = getNavigationUrl(path);
      const routePathname = navigationUrl.pathname;
      const normalizedPath = routePathname === '/' ? 'index' : routePathname.replace(/^\\//, '');
      const endpoint =
        '/_veryfront/page-data/' + normalizedPath + '.json' + navigationUrl.search;
      const startedAt = recordRouteTiming ? routeTimingNow() : 0;

      log('Fetching page data:', routePathname);
      perfStart('fetch:' + routePathname);

      const headers = options.prefetch
        ? { 'X-Veryfront-Prefetch': '1' }
        : { 'X-Veryfront-Navigation': 'spa' };
      const response = await fetchWithRetry(endpoint, {
        headers,
        signal
      }, options.prefetch ? 0 : MAX_RETRIES);
      throwIfAborted(signal);

      if (!response.ok) {
        perfEnd('fetch:' + routePathname);
        if (recordRouteTiming) {
          emitRouteTiming(
            'page-data',
            routePathname,
            startedAt,
            buildPageDataTimingDetail(response, endpoint, startedAt, timingSource)
          );
        }
        const error = new Error('Failed to fetch page data: ' + response.status);
        error.status = response.status;
        throw error;
      }

      perfStart('parse:' + routePathname);
      const data = await response.json();
      throwIfAborted(signal);
      perfEnd('parse:' + routePathname);
      perfEnd('fetch:' + routePathname);
      if (recordRouteTiming) {
        emitRouteTiming(
          'page-data',
          routePathname,
          startedAt,
          buildPageDataTimingDetail(response, endpoint, startedAt, timingSource)
        );
      }

      if (triggerReloadOnVersionMismatch) {
        const checkedData = handlePageDataVersionMismatch(path, data);
        if (checkedData !== data) return checkedData;
      }

      setCachedPageData(path, data);
      return data;
    }

    function handlePageDataVersionMismatch(path, data) {
      const buildVersionChanged =
        data?.buildVersion && checkVersionMismatch(data.buildVersion);
      const activeReleaseId = window.__veryfrontReleaseId;
      const releaseChanged =
        typeof activeReleaseId === 'string' &&
        activeReleaseId.length > 0 &&
        typeof data?.releaseId === 'string' &&
        data.releaseId.length > 0 &&
        data.releaseId !== activeReleaseId;

      if (buildVersionChanged || releaseChanged) {
        log(
          'Version mismatch detected, performing full page reload to:',
          getNavigationPathname(path),
        );
        window.location.href = path;
        throw createAbortError('Page data belongs to a different build');
      }

      return data;
    }

    function startPageDataFetch(path, signal, options = {}) {
      const request = fetchPageDataFresh(path, signal, options).finally(() => {
        if (options.trackPending !== false && pendingPageDataFetches.get(path) === request) {
          pendingPageDataFetches.delete(path);
        }
      });
      if (options.trackPending !== false) {
        pendingPageDataFetches.set(path, request);
      }
      return request;
    }

    function fetchPageDataDeduped(path) {
      const pending = pendingPageDataFetches.get(path);
      if (pending) return pending;

      return startPageDataFetch(path, null);
    }

    function refreshPageDataInBackground(path) {
      const lastRefreshAt = backgroundRefreshTimestamps.get(path) || 0;
      const now = Date.now();
      if (now - lastRefreshAt < BACKGROUND_REFRESH_INTERVAL_MS) return;

      backgroundRefreshTimestamps.set(path, now);
      fetchPageDataDeduped(path).catch((error) => {
        logBackgroundFetchFailure('Stale page data refresh', path, error);
      });
    }

    async function fetchPageDataForNavigation(path, signal) {
      const startedAt = routeTimingNow();
      const routePathname = getNavigationPathname(path);
      const cached = getCachedPageData(path);
      if (cached) {
        log('Using cached page data:', routePathname);
        const checkedData = handlePageDataVersionMismatch(path, cached);
        refreshPageDataInBackground(path);
        emitRouteTiming('page-data', routePathname, startedAt, { source: 'cache' });
        return checkedData;
      }

      const pending = pendingPageDataFetches.get(path);
      if (pending) {
        log('Reusing pending page data fetch for navigation:', routePathname);
        const data = await pending;
        throwIfAborted(signal);
        emitRouteTiming('page-data', routePathname, startedAt, { source: 'deduped' });
        return handlePageDataVersionMismatch(path, data);
      }

      return startPageDataFetch(path, signal, {
        triggerReloadOnVersionMismatch: true,
        recordRouteTiming: true,
        timingSource: 'network'
      });
    }

    async function fetchPageDataForPrefetch(path, signal) {
      if (getCachedPageData(path)) return;
      return startPageDataFetch(path, signal, { prefetch: true, trackPending: false })
        .then((data) => preloadModulesForPageData(data, path))
        .catch((error) => {
          if (!isAbortError(error)) {
            logBackgroundFetchFailure('Page data prefetch', path, error);
          }
          throw error;
        });
    }

    // ============================================
    // Navigation state
    // ============================================
    let currentPath = window.location.pathname + window.location.search;
    let currentHash = window.location.hash || '';
    let isNavigating = false;
    let navigationSequence = 0;

    function isLatestNavigation(navigation) {
      return navigation.id === navigationSequence && !navigation.signal.aborted;
    }

    function assertLatestNavigation(navigation) {
      if (!isLatestNavigation(navigation)) {
        throw createAbortError('Navigation superseded');
      }
    }

    function notifyNavigationSubscribers() {
      try {
        const navigationStore = getNavigationStore();
        if (typeof navigationStore?.notify === 'function') navigationStore.notify();
      } catch (notifyError) {
        log('Navigation subscriber notification failed:', notifyError?.message);
      }
    }

    // ============================================
    // SPA navigation handler
    // ============================================
    async function navigateSPA(
      href,
      historyMode = 'push',
      restoreScroll = false,
      providedPageData,
    ) {
      let targetUrl;
      try {
        targetUrl = getNavigationUrl(href);
      } catch (_) {
        logError('Invalid SPA navigation target');
        return;
      }

      if (targetUrl.origin !== window.location.origin) {
        if (targetUrl.protocol === 'http:' || targetUrl.protocol === 'https:') {
          window.location.href = targetUrl.href;
        } else {
          logError('Unsupported SPA navigation protocol:', targetUrl.protocol);
        }
        return;
      }

      const targetRouteHref = targetUrl.pathname + targetUrl.search;
      const resolvedHref = targetRouteHref + targetUrl.hash;
      const targetPathname = targetUrl.pathname;
      const targetHash = targetUrl.hash ? targetUrl.hash.slice(1) : '';
      const navigationId = ++navigationSequence;
      currentAbortController?.abort();

      removeQueuedPrefetch(targetRouteHref);
      abortActiveSpeculativePrefetches();

      const controller = new AbortController();
      currentAbortController = controller;
      const signal = controller.signal;
      const navigation = { id: navigationId, controller, signal };
      isNavigating = true;
      const navigationStartedAt = routeTimingNow();
      const totalPerfLabel = 'nav:total:' + navigationId + ':' + targetPathname;
      const fetchPerfLabel = 'nav:fetchData:' + navigationId + ':' + targetPathname;
      const renderPerfLabel = 'nav:render:' + navigationId + ':' + targetPathname;

      try {
        showNavigationProgress(navigationId);
        perfStart(totalPerfLabel);
        log('SPA navigating to:', targetPathname);

        saveScrollPosition(currentPath);

        perfStart(fetchPerfLabel);
        const pageData = providedPageData === undefined
          ? await fetchPageDataForNavigation(targetRouteHref, signal)
          : handlePageDataVersionMismatch(targetRouteHref, providedPageData);
        assertLatestNavigation(navigation);
        perfEnd(fetchPerfLabel);

        // getServerData redirect(): the page-data endpoint encodes it as a 200
        // { redirect: { destination } } payload. Follow it with a document
        // navigation to the target (the same net effect as the full-page 302),
        // instead of trying to render a page that does not exist here.
        // Only follow http(s)/relative destinations: assigning a javascript:/data:
        // URL to location.href would EXECUTE it (the server also filters these, so
        // this is defense in depth). Fall through to the normal error path otherwise.
        if (pageData && pageData.redirect && typeof pageData.redirect.destination === 'string') {
          let redirectTarget = null;
          try {
            redirectTarget = new URL(pageData.redirect.destination, window.location.origin);
          } catch (e) { /* invalid destination — do not follow */ }

          if (
            redirectTarget &&
            (redirectTarget.protocol === 'http:' || redirectTarget.protocol === 'https:')
          ) {
            assertLatestNavigation(navigation);
            log('SPA navigation redirect -> ' + redirectTarget.pathname);
            window.location.href = redirectTarget.href;
            return;
          }
        }

        perfStart(renderPerfLabel);
        await renderPageFromData(pageData, targetPathname, navigation, () => {
          assertLatestNavigation(navigation);

          if (historyMode === 'push') {
            window.history.pushState({ pageData, scrollY: 0 }, '', resolvedHref);
          } else if (historyMode === 'replace') {
            window.history.replaceState({ pageData, scrollY: 0 }, '', resolvedHref);
          }

          // Commit the shared router snapshot immediately before the React
          // render, after every asynchronous preparation step has completed.
          currentPath = targetRouteHref;
          currentHash = targetUrl.hash;
          window.__veryfrontRouter.path = targetPathname;
          window.__veryfrontRouter.pathname = targetPathname;
          window.__veryfrontRouter.query = Object.fromEntries(targetUrl.searchParams);
          window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);
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
              target.scrollIntoView({ behavior: 'smooth' });
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
        emitRouteTiming('total', targetPathname, navigationStartedAt, {
          historyMode,
          restoreScroll
        });
        log('SPA navigation complete');
      } catch (error) {
        if (!isLatestNavigation(navigation) || isAbortError(error)) {
          log('Navigation aborted');
          return;
        }

        logError('SPA navigation failed:', error.message);

        if (error.status === 404) {
          logError('Page not found:', targetPathname);
        }

        window.location.href = resolvedHref;
      } finally {
        perfCancel(totalPerfLabel);
        perfCancel(fetchPerfLabel);
        perfCancel(renderPerfLabel);

        if (
          navigationId === navigationSequence &&
          currentAbortController === controller
        ) {
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
    async function loadPageDataComponent(pageData, path) {
      const moduleUrl = resolveHydrationModuleUrl(
        path,
        pageData.isolatedClientPage === true,
        window.__veryfrontStudioEmbed === true,
        pageData.releaseAssetModules || null,
        pageData.releaseId || null,
      );
      const component = await loadComponentFromUrl(path, moduleUrl);
      if (!component) {
        throw new Error('Module has no renderable export: ' + path);
      }
      return component;
    }

    async function renderPageFromData(pageData, targetPath, navigation, commitNavigationState) {
      assertLatestNavigation(navigation);

      if (pageData.requiresFullDocumentNavigation) {
        throw new Error('Server layout requires full document navigation');
      }

      if (window.__veryfrontSetReleaseId) {
        window.__veryfrontSetReleaseId(pageData.releaseId || null);
      }
      if (window.__veryfrontSetReleaseAssetModules) {
        window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules || null);
      }

      perfStart('render:loadAll');
      const allPaths = getPageDataModulePaths(pageData);
      const modulesStartedAt = routeTimingNow();
      const components = await Promise.all(
        allPaths.map((path) => loadPageDataComponent(pageData, path))
      );
      assertLatestNavigation(navigation);
      emitRouteTiming('modules', targetPath, modulesStartedAt, { count: allPaths.length });
      perfEnd('render:loadAll');

      const [PageComponent, ...rest] = components;
      // errorPath is pushed last in getPageDataModulePaths, so pop it first.
      const ErrorComponent = pageData.errorPath ? rest.pop() : null;
      const AppComponent = pageData.appPath ? rest.pop() : null;
      const LayoutComponents = rest;

      if (!PageComponent) {
        throw new Error('Failed to load page component: ' + pageData.pagePath);
      }

      if (!hydrationCompleted && !hydrationFailed) {
        log('Waiting for hydration to complete before SPA render...');
        try {
          await waitForHydration(navigation.signal, 10000);
        } catch (waitError) {
          if (isAbortError(waitError)) throw waitError;
          log('Hydration wait failed:', waitError.message);
        }
      }

      assertLatestNavigation(navigation);
      commitNavigationState();

      if (pageData.frontmatter?.title) {
        document.title = pageData.frontmatter.title;
      }

      if (pageData.frontmatter?.description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        metaDesc?.setAttribute('content', pageData.frontmatter.description);
      }

      if (pageData.css) {
        const existingStyle = document.getElementById('veryfront-spa-css');
        if (existingStyle) {
          existingStyle.textContent = pageData.css;
        } else {
          const styleEl = document.createElement('style');
          const nonce = getDocumentNonce();
          if (nonce) styleEl.setAttribute('nonce', nonce);
          styleEl.id = 'veryfront-spa-css';
          styleEl.textContent = pageData.css;
          document.head.appendChild(styleEl);
        }
        log('Injected CSS for SPA navigation', { cssLength: pageData.css.length });
      } else if (pageData.cssAction === 'clear') {
        const existingStyle = document.getElementById('veryfront-spa-css');
        if (existingStyle) {
          existingStyle.remove();
          log('Cleared SPA CSS for release stylesheet navigation');
        }
      }

      // Normalize catch-all params (arrays -> joined strings) so page props and
      // page context match the server render exactly. SSR emits joined strings
      // via flattenRouteParams; without this the client would hand raw arrays to
      // props and usePageContext() after navigation (issue #2742).
      const normalizedParams = normalizeRouteParams(pageData.params);

      let tree = React.createElement(PageComponent, {
        ...pageData.props,
        params: normalizedParams
      });

      if (pageData.layouts?.length) {
        for (let i = pageData.layouts.length - 1; i >= 0; i--) {
          const layout = pageData.layouts[i];
          const LayoutComponent = LayoutComponents[i];
          if (!LayoutComponent) continue;

          const layoutProps = pageData.layoutProps?.[layout.path] || {};
          tree = React.createElement(LayoutComponent, { ...layoutProps, children: tree });
        }
      }

      if (AppComponent) {
        tree = React.createElement(AppComponent, { children: tree });
        log('Wrapped with App component for SPA navigation');
      }

      // App-router error.tsx boundary — wraps the page so a throw during a
      // client-side navigation render is caught and error.tsx renders (matching
      // the server + initial-hydration boundary), with a working reset().
      if (ErrorComponent) {
        class AppRouterErrorBoundary extends React.Component {
          constructor(props) { super(props); this.state = { hasError: false, error: null }; }
          static getDerivedStateFromError(error) { return { hasError: true, error: error }; }
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
        slug: pageData.slug || '',
        path: pageData.pagePath || targetPath,
        params: normalizedParams,
        query: { ...router.query },
        frontmatter: pageData.frontmatter || {},
        data: pageData.props || {},
        headings: headingsArray,
        mdxHeadings: headingsArray
      };

      tree = React.createElement(PageContextProvider, { pageContext, children: tree });
      tree = React.createElement(RouterProvider, { router, children: tree });

      const container = pageData.isolatedClientPage
        ? document.getElementById('veryfront-page-island')
        : document.getElementById('root');

      assertLatestNavigation(navigation);
      if (container?.__reactRoot) {
        perfStart('render:reactRender');
        container.__reactRoot.render(tree);
        perfEnd('render:reactRender');
        log('Page re-rendered via SPA');
        scheduleRoutePrefetchRefresh();
        return;
      }

      if (hydrationFailed) {
        throw new Error('React root not found - hydration failed, falling back to full page navigation');
      }

      throw new Error('React root not found');
    }

    // ============================================
    // Prefetching on hover
    // ============================================
    let prefetchTimeout = null;
    let currentHoverLink = null;
    let routePrefetchRefreshPending = false;
    let viewportPrefetchObserver = null;
    const observedPrefetchLinks = new WeakSet();
    const prefetchedPaths = new Set();
    const inFlightPrefetches = new Set();
    const queuedPrefetchPaths = new Set();
    const pageDataPrefetchQueue = [];
    const activePageDataPrefetchControllers = new Map();

    function cancelScheduledPrefetch() {
      if (prefetchTimeout) {
        clearTimeout(prefetchTimeout);
        prefetchTimeout = null;
      }

      currentHoverLink = null;
    }

    function getPageDataModulePaths(pageData) {
      const layoutPaths = (pageData.layouts || []).map((l) => l.path).filter(Boolean);
      const allPaths = [pageData.pagePath, ...layoutPaths].filter(Boolean);

      if (pageData.appPath) allPaths.push(pageData.appPath);
      if (pageData.errorPath) allPaths.push(pageData.errorPath);

      return allPaths;
    }

    function getCurrentRouteHref() {
      return window.location.pathname + window.location.search;
    }

    function getInternalRouteHrefFromLink(link) {
      if (
        !link ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        link.getAttribute('data-prefetch') === 'false'
      ) {
        return null;
      }

      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('//') || !href.startsWith('/')) return null;

      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return null;

        const routeHref = url.pathname + url.search;
        return routeHref === getCurrentRouteHref() ? null : routeHref;
      } catch (_) {
        return null;
      }
    }

    function getEligiblePrefetchLinks(limit) {
      const links = [];
      const seenHrefs = new Set();

      for (const link of document.querySelectorAll('a[href]')) {
        const href = getInternalRouteHrefFromLink(link);
        if (!href || seenHrefs.has(href)) continue;

        seenHrefs.add(href);
        links.push({ link, href });

        if (links.length >= limit) break;
      }

      return links;
    }

    async function preloadModulesForPageData(pageData, path) {
      if (!pageData || pageData.requiresFullDocumentNavigation) return;
      // Never let speculative work replace the active route's release context.
      // A cross-build payload stays cached so the foreground navigation can
      // perform the canonical full reload, but its modules are not evaluated.
      if (pageData.buildVersion && getBuildVersionMismatch(pageData.buildVersion)) return;
      const activeReleaseId = window.__veryfrontReleaseId;
      if (
        typeof activeReleaseId === 'string' &&
        activeReleaseId.length > 0 &&
        typeof pageData.releaseId === 'string' &&
        pageData.releaseId.length > 0 &&
        pageData.releaseId !== activeReleaseId
      ) {
        return;
      }

      const modulePaths = getPageDataModulePaths(pageData);
      if (modulePaths.length === 0) return;

      try {
        await Promise.all(
          modulePaths.map((modulePath) => loadPageDataComponent(pageData, modulePath))
        );
      } catch (error) {
        logBackgroundFetchFailure('Module prefetch', path, error);
      }
    }

    function removeQueuedPrefetch(path) {
      queuedPrefetchPaths.delete(path);
      for (let i = pageDataPrefetchQueue.length - 1; i >= 0; i--) {
        if (pageDataPrefetchQueue[i] === path) pageDataPrefetchQueue.splice(i, 1);
      }
    }

    function abortActiveSpeculativePrefetches() {
      for (const controller of activePageDataPrefetchControllers.values()) {
        controller.abort();
      }
    }

    function processPageDataPrefetchQueue() {
      if (isNavigating) return;

      while (
        activePageDataPrefetchControllers.size < PAGE_DATA_PREFETCH_CONCURRENCY &&
        pageDataPrefetchQueue.length > 0
      ) {
        const href = pageDataPrefetchQueue.shift();
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
          .catch(() => {
            prefetchedPaths.delete(href);
          })
          .finally(() => {
            inFlightPrefetches.delete(href);
            activePageDataPrefetchControllers.delete(href);
            processPageDataPrefetchQueue();
          });
      }
    }

    function prefetchPage(href) {
      if (isNavigating) return;
      if (prefetchedPaths.has(href) || inFlightPrefetches.has(href) || queuedPrefetchPaths.has(href)) return;

      const cachedPageData = getCachedPageData(href);
      if (cachedPageData) {
        preloadModulesForPageData(cachedPageData, href).catch((error) => {
          logBackgroundFetchFailure('Module prefetch', href, error);
        });
        return;
      }

      queuedPrefetchPaths.add(href);
      pageDataPrefetchQueue.push(href);
      processPageDataPrefetchQueue();
    }

    function prefetchEligibleRouteLinks(limit) {
      for (const { href } of getEligiblePrefetchLinks(limit)) {
        prefetchPage(href);
      }
    }

    function ensureViewportPrefetchObserver() {
      if (viewportPrefetchObserver || typeof IntersectionObserver !== 'function') {
        return viewportPrefetchObserver;
      }

      viewportPrefetchObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;

          viewportPrefetchObserver?.unobserve(entry.target);
          const href = getInternalRouteHrefFromLink(entry.target);
          if (href) prefetchPage(href);
        }
      }, { rootMargin: VIEWPORT_PREFETCH_ROOT_MARGIN });

      return viewportPrefetchObserver;
    }

    function observeViewportPrefetchLinks() {
      const observer = ensureViewportPrefetchObserver();
      if (!observer) return;

      for (const { link } of getEligiblePrefetchLinks(VIEWPORT_PREFETCH_MAX_LINKS)) {
        if (observedPrefetchLinks.has(link)) continue;

        observedPrefetchLinks.add(link);
        observer.observe(link);
      }
    }

    function runRoutePrefetchRefresh() {
      routePrefetchRefreshPending = false;
      prefetchEligibleRouteLinks(IDLE_PREFETCH_MAX_LINKS);
      observeViewportPrefetchLinks();
    }

    function scheduleRoutePrefetchRefresh() {
      if (routePrefetchRefreshPending) return;

      routePrefetchRefreshPending = true;
      setTimeout(() => {
        if (typeof requestIdleCallback === 'function') {
          requestIdleCallback(runRoutePrefetchRefresh, { timeout: IDLE_PREFETCH_DELAY_MS });
          return;
        }

        runRoutePrefetchRefresh();
      }, IDLE_PREFETCH_DELAY_MS);
    }

    // ============================================
    // Route params normalization
    // ============================================
    // Catch-all segments arrive as arrays and are joined so no path info is
    // lost, matching the server flattenRouteParams + RSC hydration normalizer.
    function normalizeRouteParams(raw) {
      const out = {};
      if (!raw || typeof raw !== 'object') return out;
      for (const key of Object.keys(raw)) {
        const value = raw[key];
        if (value === undefined) continue;
        Object.defineProperty(out, key, {
          configurable: true,
          enumerable: true,
          value: Array.isArray(value) ? value.join('/') : value,
          writable: true,
        });
      }
      return out;
    }

    // ============================================
    // Router object
    // ============================================
    const router = {
      domain: window.location.origin,
      path: window.location.pathname,
      push: (path) => {
        void navigateSPA(path, 'push');
      },
      replace: (path) => {
        void navigateSPA(path, 'replace');
      },
      back: () => {
        window.history.back();
      },
      forward: () => {
        window.history.forward();
      },
      prefetch: (path) => {
        prefetchPage(path);
      },
      pathname: window.location.pathname,
      query: Object.fromEntries(new URLSearchParams(window.location.search)),
      // Seed route params from the hydration data (issue #2741). Catch-all
      // segments arrive as arrays and are joined so no path info is lost.
      params: (function () {
        try {
          const el = document.getElementById('veryfront-hydration-data');
          const raw = (JSON.parse(el && el.textContent ? el.textContent : '{}') || {}).params || {};
          return normalizeRouteParams(raw);
        } catch (_) {
          return {};
        }
      })(),
      isPreview: false,
      isMounted: true,
      navigate: (path) => navigateSPA(path, 'push'),
      reload: () => window.location.reload()
    };

    window.__veryfrontRouter = router;

    // Route useRouter().push/replace/navigate (from veryfront/router) through the
    // same SPA navigator that intercepts <Link> clicks. Without this the shared
    // navigation store has no navigator registered and its navigate() falls back
    // to a full-page location.assign (finding #7: push() full-reloads).
    if (
      typeof navigationStoreUsesRegistryFallback !== 'undefined' &&
      navigationStoreUsesRegistryFallback
    ) {
      log('Router runtime does not export getNavigationStore; using shared v1 registry fallback');
    }
    if (typeof getNavigationStore === 'function') {
      const navigationStore = getNavigationStore();
      const previousNavigatorDisposer = window.__veryfrontNavigationStoreDisposer;
      if (typeof previousNavigatorDisposer === 'function') {
        previousNavigatorDisposer();
      }
      const navigationStoreDisposer = navigationStore.setNavigator((href, options) => {
        const mode = options && options.history;
        const historyMode = mode === 'replace' ? 'replace' : mode === 'none' ? 'none' : 'push';
        return navigateSPA(href, historyMode);
      });
      window.__veryfrontNavigationStoreDisposer =
        typeof navigationStoreDisposer === 'function' ? navigationStoreDisposer : null;
    }

    // ============================================
    // Event handlers
    // ============================================
    window.addEventListener('popstate', async (e) => {
      const routeHref = window.location.pathname + window.location.search;
      const nextHash = window.location.hash || '';
      if (routeHref === currentPath && nextHash !== currentHash) {
        currentHash = nextHash;
        notifyNavigationSubscribers();
        return;
      }

      const href = routeHref + nextHash;
      log('Popstate:', window.location.pathname);
      await navigateSPA(href, 'none', true, e.state?.pageData);
    });

    window.addEventListener('hashchange', () => {
      const nextHash = window.location.hash || '';
      if (nextHash === currentHash) return;

      currentHash = nextHash;
      notifyNavigationSubscribers();
    });

    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || (typeof e.button === 'number' && e.button !== 0)) return;
      if (!e.target || typeof e.target.closest !== 'function') return;
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        let targetId = href.slice(1);
        try {
          targetId = decodeURIComponent(targetId);
        } catch (_) {
          // Keep the literal fragment when it is not valid percent-encoding.
        }
        const target = document.getElementById(targetId) ||
          document.getElementsByName(targetId)[0];
        if (!target) return;

        e.preventDefault();
        window.history.pushState(window.history.state, '', href);
        currentHash = window.location.hash || href;
        notifyNavigationSubscribers();
        target.scrollIntoView({ behavior: 'smooth' });
        return;
      }

      if (
        (link.target && link.target !== '_self') ||
        link.hasAttribute('download') ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        !href.startsWith('/') ||
        href.startsWith('//')
      ) {
        return;
      }

      e.preventDefault();
      cancelScheduledPrefetch();
      void navigateSPA(href, 'push');
    });

    document.addEventListener(
      'mouseenter',
      (e) => {
        if (!e.target || typeof e.target.closest !== 'function') return;
        const link = e.target.closest('a[href]');
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
      true
    );

    document.addEventListener(
      'mouseleave',
      (e) => {
        if (!e.target || typeof e.target.closest !== 'function') return;

        const relatedTarget = e.relatedTarget;
        if (currentHoverLink && relatedTarget && currentHoverLink.contains(relatedTarget)) return;

        cancelScheduledPrefetch();
      },
      true
    );

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', scheduleRoutePrefetchRefresh, { once: true });
    } else {
      scheduleRoutePrefetchRefresh();
    }

    // ============================================
    // Router hooks
    // ============================================
    window.useRouter = () => {
      try {
        return useRouterFromModule();
      } catch (_) {
        /* expected: useRouterFromModule may not be available, fall back to global router */
        return window.__veryfrontRouter;
      }
    };
`;
