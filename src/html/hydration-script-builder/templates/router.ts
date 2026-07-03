export const getRouterScript = () => `
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    // ============================================
    // Hydration state tracking
    // ============================================
    let hydrationResolve;
    let hydrationReject;
    const hydrationPromise = new Promise((resolve, reject) => {
      hydrationResolve = resolve;
      hydrationReject = reject;
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
      hydrationReject(error);
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
    const VIEWPORT_PREFETCH_ROOT_MARGIN = '200px';
    const MAX_ROUTE_TIMINGS = 100;
    const MAX_SERVER_TIMING_LENGTH = 1024;

    // ============================================
    // Debug logging (production-safe)
    // ============================================
    const log = DEBUG ? console.log.bind(console, '[Veryfront]') : () => {};
    const logError = console.error.bind(console, '[Veryfront]');

    function logBackgroundFetchFailure(reason, path, error) {
      const message = error?.message ?? String(error);
      log(reason + ' failed:', path, message);
    }

    function getDocumentNonce() {
      const element = document.querySelector('script[nonce], style[nonce], link[nonce]');
      if (!element) return undefined;

      return element.nonce || element.getAttribute('nonce') || undefined;
    }

    // ============================================
    // Version tracking for cache invalidation
    // ============================================
    let clientBuildVersion = null;

    function checkVersionMismatch(newVersion) {
      if (!clientBuildVersion) {
        clientBuildVersion = newVersion;
        log('Build version initialized:', newVersion);
        return false;
      }

      if (newVersion.serverStart !== clientBuildVersion.serverStart) {
        log('Server restarted, reloading...', {
          old: clientBuildVersion.serverStart,
          new: newVersion.serverStart
        });
        return true;
      }

      if (newVersion.framework !== clientBuildVersion.framework) {
        log('Framework version changed, reloading...', {
          old: clientBuildVersion.framework,
          new: newVersion.framework
        });
        return true;
      }

      if (
        newVersion.projectUpdated &&
        clientBuildVersion.projectUpdated &&
        newVersion.projectUpdated !== clientBuildVersion.projectUpdated
      ) {
        log('Project content updated, reloading...', {
          old: clientBuildVersion.projectUpdated,
          new: newVersion.projectUpdated
        });
        return true;
      }

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

      if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;

      pageDataCache.delete(path);
      backgroundRefreshTimestamps.delete(path);
      return null;
    }

    function setCachedPageData(path, data) {
      if (pageDataCache.size >= MAX_CACHE_SIZE) {
        const oldest = pageDataCache.keys().next().value;
        if (oldest) {
          pageDataCache.delete(oldest);
          backgroundRefreshTimestamps.delete(oldest);
        }
      }

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

    function restoreScrollPosition(path) {
      const savedY = scrollPositions.get(path);
      if (savedY === undefined) return false;

      requestAnimationFrame(() => window.scrollTo(0, savedY));
      return true;
    }

    // ============================================
    // Loading progress indicator
    // ============================================
    let progressBar = null;
    let progressTimeout = null;

    function showNavigationProgress() {
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
        progressBar?.style && (progressBar.style.width = '70%');
      }, 300);

      document.body.setAttribute('aria-busy', 'true');
    }

    function hideNavigationProgress() {
      if (progressTimeout) {
        clearTimeout(progressTimeout);
        progressTimeout = null;
      }

      if (progressBar) {
        progressBar.style.width = '100%';
        setTimeout(() => {
          if (!progressBar) return;

          progressBar.style.opacity = '0';
          setTimeout(() => {
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

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function fetchWithRetry(url, options, maxRetries = MAX_RETRIES) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(url, { ...options, signal: controller.signal });
          clearTimeout(timeout);

          if (response.ok) return response;

          if (response.status >= 500 && attempt < maxRetries) {
            log('Server error, retrying...', response.status);
            await sleep(Math.pow(2, attempt) * 500);
            continue;
          }

          return response;
        } catch (error) {
          clearTimeout(timeout);

          if (error.name === 'AbortError' && options.signal?.aborted) throw error;
          if (attempt === maxRetries) throw error;

          log('Fetch failed, retrying...', error.message);
          await sleep(Math.pow(2, attempt) * 500);
        }
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
      const normalizedPath = path === '/' ? '' : path.replace(/^\\//, '');
      const endpoint = '/_veryfront/page-data/' + normalizedPath + '.json';
      const startedAt = recordRouteTiming ? routeTimingNow() : 0;

      log('Fetching page data:', path);
      perfStart('fetch:' + path);

      const response = await fetchWithRetry(endpoint, {
        headers: { 'X-Veryfront-Navigation': 'spa' },
        signal
      });

      if (!response.ok) {
        perfEnd('fetch:' + path);
        if (recordRouteTiming) {
          emitRouteTiming(
            'page-data',
            path,
            startedAt,
            buildPageDataTimingDetail(response, endpoint, startedAt, timingSource)
          );
        }
        const error = new Error('Failed to fetch page data: ' + response.status);
        error.status = response.status;
        throw error;
      }

      perfStart('parse:' + path);
      const data = await response.json();
      perfEnd('parse:' + path);
      perfEnd('fetch:' + path);
      if (recordRouteTiming) {
        emitRouteTiming(
          'page-data',
          path,
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
      if (data.buildVersion && checkVersionMismatch(data.buildVersion)) {
        log('Version mismatch detected, performing full page reload to:', path);
        window.location.href = path;
        return new Promise(() => {});
      }

      return data;
    }

    function startPageDataFetch(path, signal, options = {}) {
      const request = fetchPageDataFresh(path, signal, options).finally(() => {
        if (pendingPageDataFetches.get(path) === request) {
          pendingPageDataFetches.delete(path);
        }
      });
      pendingPageDataFetches.set(path, request);
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
      const cached = getCachedPageData(path);
      if (cached) {
        log('Using cached page data:', path);
        refreshPageDataInBackground(path);
        emitRouteTiming('page-data', path, startedAt, { source: 'cache' });
        return cached;
      }

      const pending = pendingPageDataFetches.get(path);
      if (pending) {
        log('Reusing pending page data fetch for navigation:', path);
        const data = await pending;
        emitRouteTiming('page-data', path, startedAt, { source: 'deduped' });
        return handlePageDataVersionMismatch(path, data);
      }

      return startPageDataFetch(path, signal, {
        triggerReloadOnVersionMismatch: true,
        recordRouteTiming: true,
        timingSource: 'network'
      });
    }

    async function fetchPageDataForPrefetch(path) {
      if (getCachedPageData(path)) return;
      return fetchPageDataDeduped(path)
        .then((data) => preloadModulesForPageData(data, path))
        .catch((error) => {
          logBackgroundFetchFailure('Page data prefetch', path, error);
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
    async function navigateSPA(href, pushState = true, restoreScroll = false) {
      currentAbortController?.abort();

      if (isNavigating) return;
      isNavigating = true;

      currentAbortController = new AbortController();
      const signal = currentAbortController.signal;
      const navigationStartedAt = routeTimingNow();

      showNavigationProgress();
      perfStart('nav:total:' + href);

      try {
        log('SPA navigating to:', href);

        saveScrollPosition(currentPath);

        const [path, hash] = href.split('#');
        const targetPath = path || currentPath;

        perfStart('nav:fetchData:' + href);
        const pageData = await fetchPageDataForNavigation(targetPath, signal);
        perfEnd('nav:fetchData:' + href);

        if (signal.aborted) return;

        if (pushState) {
          window.history.pushState({ pageData, scrollY: 0 }, '', href);
        }

        perfStart('nav:render:' + href);
        await renderPageFromData(pageData, targetPath);
        perfEnd('nav:render:' + href);

        currentPath = targetPath;
        window.__veryfrontRouter.pathname = targetPath;
        window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));

        if (restoreScroll) {
          restoreScrollPosition(targetPath);
        } else if (hash) {
          requestAnimationFrame(() => {
            const target = document.getElementById(hash);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth' });
              return;
            }
            window.scrollTo(0, 0);
          });
        } else {
          window.scrollTo(0, 0);
        }

        hideNavigationProgress();
        perfEnd('nav:total:' + href);
        emitRouteTiming('total', targetPath, navigationStartedAt, { href, pushState, restoreScroll });
        log('SPA navigation complete');
      } catch (error) {
        hideNavigationProgress();

        if (error.name === 'AbortError') {
          log('Navigation aborted');
          return;
        }

        logError('SPA navigation failed:', error.message);

        if (error.status === 404) {
          logError('Page not found:', href);
        }

        window.location.href = href;
      } finally {
        isNavigating = false;
        currentAbortController = null;
      }
    }

    // ============================================
    // Render page from page data
    // ============================================
    async function renderPageFromData(pageData, targetPath) {
      if (window.__veryfrontSetReleaseId) {
        window.__veryfrontSetReleaseId(pageData.releaseId || null);
      }
      if (window.__veryfrontSetReleaseAssetModules) {
        window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules || null);
      }

      perfStart('render:loadAll');
      const allPaths = getPageDataModulePaths(pageData);
      const modulesStartedAt = routeTimingNow();
      const components = await Promise.all(allPaths.map((path) => loadComponent(path)));
      emitRouteTiming('modules', targetPath, modulesStartedAt, { count: allPaths.length });
      perfEnd('render:loadAll');

      const [PageComponent, ...rest] = components;
      const AppComponent = pageData.appPath ? rest.pop() : null;
      const LayoutComponents = rest;

      if (!PageComponent) {
        throw new Error('Failed to load page component: ' + pageData.pagePath);
      }

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

      let tree = React.createElement(PageComponent, {
        ...pageData.props,
        params: pageData.params
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

      const headingsArray = pageData.headings || [];
      const pageContext = {
        slug: pageData.slug || '',
        path: pageData.pagePath || targetPath,
        params: pageData.params || {},
        query: Object.fromEntries(new URLSearchParams(window.location.search)),
        frontmatter: pageData.frontmatter || {},
        headings: headingsArray,
        mdxHeadings: headingsArray
      };

      tree = React.createElement(PageContextProvider, { pageContext, children: tree });
      tree = React.createElement(RouterProvider, { router, children: tree });

      const container = document.getElementById('root');

      if (!hydrationCompleted && !hydrationFailed) {
        log('Waiting for hydration to complete before SPA render...');
        try {
          await Promise.race([
            hydrationPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Hydration timeout')), 10000))
          ]);
        } catch (waitError) {
          log('Hydration wait failed:', waitError.message);
        }
      }

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
      if (!pageData) return;
      if (pageData.releaseId && window.__veryfrontSetReleaseId) {
        window.__veryfrontSetReleaseId(pageData.releaseId);
      }
      if (pageData.releaseAssetModules && window.__veryfrontSetReleaseAssetModules) {
        window.__veryfrontSetReleaseAssetModules(pageData.releaseAssetModules);
      }

      const modulePaths = getPageDataModulePaths(pageData);
      if (modulePaths.length === 0) return;

      try {
        await Promise.all(modulePaths.map((modulePath) => loadComponent(modulePath)));
      } catch (error) {
        logBackgroundFetchFailure('Module prefetch', path, error);
      }
    }

    function prefetchPage(href) {
      if (isNavigating) return;
      if (prefetchedPaths.has(href) || inFlightPrefetches.has(href)) return;

      const cachedPageData = getCachedPageData(href);
      if (cachedPageData) {
        preloadModulesForPageData(cachedPageData, href).catch((error) => {
          logBackgroundFetchFailure('Module prefetch', href, error);
        });
        return;
      }

      if (prefetchedPaths.size >= MAX_PREFETCH_PATHS) {
        const oldest = prefetchedPaths.values().next().value;
        if (oldest) prefetchedPaths.delete(oldest);
      }

      prefetchedPaths.add(href);
      inFlightPrefetches.add(href);

      fetchPageDataForPrefetch(href)
        .catch(() => {
          prefetchedPaths.delete(href);
        })
        .finally(() => {
          inFlightPrefetches.delete(href);
        });
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
    // Router object
    // ============================================
    const router = {
      domain: window.location.origin,
      path: window.location.pathname,
      push: (path) => {
        void navigateSPA(path, true);
      },
      replace: (path) => {
        void navigateSPA(path, false);
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
          const out = {};
          for (const key in raw) {
            out[key] = Array.isArray(raw[key]) ? raw[key].join('/') : raw[key];
          }
          return out;
        } catch (_) {
          return {};
        }
      })(),
      isPreview: false,
      isMounted: true,
      navigate: (path) => navigateSPA(path, true),
      reload: () => window.location.reload()
    };

    window.__veryfrontRouter = router;

    // ============================================
    // Event handlers
    // ============================================
    window.addEventListener('popstate', async (e) => {
      const path = window.location.pathname;
      log('Popstate:', path);

      saveScrollPosition(currentPath);

      if (!e.state?.pageData) {
        await navigateSPA(path, false, true);
        return;
      }

      showNavigationProgress();
      try {
        await renderPageFromData(e.state.pageData, path);
        currentPath = path;
        window.__veryfrontRouter.pathname = path;
        window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));

        restoreScrollPosition(path);
        hideNavigationProgress();
      } catch (error) {
        hideNavigationProgress();
        logError('Popstate render failed:', error.message);
        window.location.reload();
      }
    });

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      if (href.startsWith('#')) {
        const target = document.getElementById(href.slice(1));
        if (!target) return;

        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
        window.history.pushState(null, '', href);
        return;
      }

      if (
        link.target === '_blank' ||
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
      void navigateSPA(href, true);
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
