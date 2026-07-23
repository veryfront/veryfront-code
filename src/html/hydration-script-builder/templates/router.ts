import {
  MAX_HTML_HEADINGS,
  MAX_HTML_HYDRATION_DATA_BYTES,
  MAX_HTML_NESTED_LAYOUTS,
  MAX_HTML_PATH_BYTES,
  MAX_HTML_RELEASE_ID_BYTES,
} from "../../limits.ts";

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
    void hydrationPromise.catch(() => {});
    let hydrationCompleted = false;
    let hydrationFailed = false;

    window.__veryfrontHydrationComplete = () => {
      if (hydrationCompleted || hydrationFailed) return;
      hydrationCompleted = true;
      hydrationResolve();
      log('Hydration complete signal received');
    };

    window.__veryfrontHydrationFailed = (error) => {
      if (hydrationCompleted || hydrationFailed) return;
      hydrationFailed = true;
      hydrationReject(error);
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      logError('Hydration failed signal received (' + errorName + ')');
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
    const MAX_ROUTE_HREF_LENGTH = ${MAX_HTML_PATH_BYTES};
    const MAX_PERF_TIMERS = 200;
    const MAX_PENDING_PAGE_DATA_FETCHES = 64;
    const MAX_PAGE_DATA_BYTES = ${MAX_HTML_HYDRATION_DATA_BYTES};
    const MAX_PAGE_DATA_CACHE_BYTES = 16 * 1024 * 1024;
    const MAX_PAGE_MODULES = ${MAX_HTML_NESTED_LAYOUTS};
    const MAX_IN_FLIGHT_PREFETCHES = 8;
    const MAX_BACKGROUND_REFRESH_TIMESTAMPS = 100;
    const MAX_PAGE_DATA_PARAMS = 100;
    const MAX_PAGE_DATA_PARAM_VALUES = 100;
    const MAX_PAGE_DATA_HEADINGS = ${MAX_HTML_HEADINGS};
    const MAX_PAGE_DATA_OBJECT_ENTRIES = 10000;
    const MAX_RELEASE_ASSET_MODULES = 10000;

    // ============================================
    // Debug logging (production-safe)
    // ============================================
    const log = DEBUG ? console.log.bind(console, '[Veryfront]') : () => {};
    const logError = console.error.bind(console, '[Veryfront]');

    function getErrorName(error) {
      return error instanceof Error && error.name ? error.name : 'UnknownError';
    }

    function getSafeRoutePath(value) {
      try {
        return new URL(String(value || '/'), window.location.origin).pathname.slice(0, 1024) || '/';
      } catch (_) {
        return '/';
      }
    }

    function hasUnsafeNavigationCharacter(value) {
      for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (
          value[index] === '\\\\' || code <= 31 || (code >= 127 && code <= 159) ||
          code === 0x200e || code === 0x200f ||
          (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        ) return true;
        if (code >= 0xdc00 && code <= 0xdfff) return true;
        if (code < 0xd800 || code > 0xdbff) continue;
        const next = value.charCodeAt(index + 1);
        if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
        index++;
      }
      return false;
    }

    function getInternalNavigationUrl(value) {
      if (typeof value !== 'string' || !value || value.length > MAX_ROUTE_HREF_LENGTH ||
          hasUnsafeNavigationCharacter(value)) {
        throw new TypeError('Navigation URL is invalid');
      }

      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || url.username || url.password) {
        throw new TypeError('Navigation URL must be same-origin');
      }
      let decodedPath = url.pathname;
      while (true) {
        let next;
        try {
          next = decodeURIComponent(decodedPath);
        } catch (_) {
          throw new TypeError('Navigation URL has invalid percent encoding');
        }
        if (next === decodedPath) break;
        if (next.length >= decodedPath.length) {
          throw new TypeError('Navigation URL percent decoding did not make progress');
        }
        decodedPath = next;
      }
      if (
        hasUnsafeNavigationCharacter(decodedPath) ||
        decodedPath.includes('?') || decodedPath.includes('#') ||
        decodedPath.split('/').some((segment) => segment === '.' || segment === '..')
      ) {
        throw new TypeError('Navigation URL contains an unsafe path segment');
      }
      return url;
    }

    function isPlainObject(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const prototype = Object.getPrototypeOf(value);
      return prototype === Object.prototype || prototype === null;
    }

    function assertValidPageData(data) {
      if (!isPlainObject(data)) throw new TypeError('Page data must be an object');
      for (const key of ['pagePath', 'appPath', 'appRouterRoot', 'slug', 'releaseId']) {
        if (data[key] !== undefined && typeof data[key] !== 'string') {
          throw new TypeError('Page data contains an invalid string field');
        }
      }
      for (const key of ['pagePath', 'appPath']) {
        if (data[key] !== undefined) {
          if (!data[key] || data[key].length > MAX_ROUTE_HREF_LENGTH) {
            throw new TypeError('Page data contains an invalid module path');
          }
          assertSafeModulePath(data[key]);
        }
      }
      if (data.appRouterRoot !== undefined) {
        if (!data.appRouterRoot || data.appRouterRoot.length > MAX_ROUTE_HREF_LENGTH) {
          throw new TypeError('Page data contains an invalid App Router root');
        }
        assertSafeModulePath(data.appRouterRoot);
      }
      if (
        data.slug?.length > MAX_ROUTE_HREF_LENGTH ||
        data.releaseId?.length > ${MAX_HTML_RELEASE_ID_BYTES}
      ) {
        throw new TypeError('Page data contains an oversized string field');
      }
      if (data.css !== undefined && typeof data.css !== 'string') {
        throw new TypeError('Page data CSS must be a string');
      }
      if (data.css?.length > MAX_PAGE_DATA_BYTES) {
        throw new TypeError('Page data CSS exceeds the size limit');
      }
      if (data.layouts !== undefined) {
        if (!Array.isArray(data.layouts) || data.layouts.length > MAX_PAGE_MODULES) {
          throw new TypeError('Page data layouts are invalid');
        }
        for (const layout of data.layouts) {
          if (
            !isPlainObject(layout) || typeof layout.path !== 'string' ||
            !['mdx', 'tsx'].includes(layout.kind) || !layout.path ||
            layout.path.length > MAX_ROUTE_HREF_LENGTH
          ) {
            throw new TypeError('Page data layout is invalid');
          }
          assertSafeModulePath(layout.path);
        }
      }
      for (const key of ['props', 'params', 'frontmatter', 'layoutProps', 'releaseAssetModules']) {
        if (data[key] !== undefined && !isPlainObject(data[key])) {
          throw new TypeError('Page data contains an invalid object field');
        }
      }
      if (data.props && Object.keys(data.props).length > MAX_PAGE_DATA_OBJECT_ENTRIES) {
        throw new TypeError('Page data props exceed the entry limit');
      }
      if (data.params) {
        const paramEntries = Object.entries(data.params);
        if (paramEntries.length > MAX_PAGE_DATA_PARAMS) {
          throw new TypeError('Page data params exceed the entry limit');
        }
        for (const [key, value] of paramEntries) {
          if (!key || key.length > MAX_ROUTE_HREF_LENGTH) {
            throw new TypeError('Page data params contain an invalid key');
          }
          if (typeof value === 'string' && value.length <= MAX_ROUTE_HREF_LENGTH) continue;
          if (
            Array.isArray(value) && value.length <= MAX_PAGE_DATA_PARAM_VALUES &&
            value.every((item) => typeof item === 'string') &&
            value.join('/').length <= MAX_ROUTE_HREF_LENGTH
          ) continue;
          throw new TypeError('Page data params contain an invalid value');
        }
      }
      if (data.frontmatter && Object.keys(data.frontmatter).length > MAX_PAGE_DATA_OBJECT_ENTRIES) {
        throw new TypeError('Page data frontmatter exceeds the entry limit');
      }
      if (data.layoutProps) {
        const layoutPropEntries = Object.entries(data.layoutProps);
        if (layoutPropEntries.length > MAX_PAGE_MODULES) {
          throw new TypeError('Page data layout props exceed the entry limit');
        }
        for (const [path, value] of layoutPropEntries) {
          if (!path || path.length > MAX_ROUTE_HREF_LENGTH || !isPlainObject(value)) {
            throw new TypeError('Page data layout props contain an invalid entry');
          }
          assertSafeModulePath(path);
          if (Object.keys(value).length > MAX_PAGE_DATA_OBJECT_ENTRIES) {
            throw new TypeError('Page data layout props exceed the entry limit');
          }
        }
      }
      if (data.releaseAssetModules) {
        const assetEntries = Object.entries(data.releaseAssetModules);
        if (assetEntries.length > MAX_RELEASE_ASSET_MODULES) {
          throw new TypeError('Page data release asset modules exceed the entry limit');
        }
        for (const [path, value] of assetEntries) {
          if (
            !path || path.length > MAX_ROUTE_HREF_LENGTH || path.startsWith('/') ||
            typeof value !== 'string' || !value || value.length > MAX_ROUTE_HREF_LENGTH
          ) {
            throw new TypeError('Page data release asset modules contain an invalid entry');
          }
          assertSafeModulePath(path);
        }
      }
      if (data.headings !== undefined) {
        if (!Array.isArray(data.headings) || data.headings.length > MAX_PAGE_DATA_HEADINGS) {
          throw new TypeError('Page data headings are invalid');
        }
        for (const heading of data.headings) {
          if (
            !isPlainObject(heading) || typeof heading.id !== 'string' ||
            typeof heading.text !== 'string' || !Number.isSafeInteger(heading.level) ||
            heading.level <= 0 || heading.level > 6 ||
            heading.id.length > MAX_ROUTE_HREF_LENGTH ||
            heading.text.length > MAX_ROUTE_HREF_LENGTH
          ) {
            throw new TypeError('Page data heading is invalid');
          }
        }
      }
      return data;
    }

    function logBackgroundFetchFailure(reason, path, error) {
      log(reason + ' failed (' + getErrorName(error) + '):', getSafeRoutePath(path));
    }

    const REACT_COMPONENT_SYMBOLS = new Set([
      Symbol.for('react.forward_ref'),
      Symbol.for('react.lazy'),
      Symbol.for('react.memo')
    ]);

    function isReactComponent(value) {
      if (typeof value === 'function') return true;
      if (!value || typeof value !== 'object') return false;
      return typeof value.$$typeof === 'symbol' && REACT_COMPONENT_SYMBOLS.has(value.$$typeof);
    }

    function selectComponentExport(module, path) {
      const component = /\\.mdx?(?:[?#].*)?$/.test(path)
        ? module?.MDXLayout ?? module?.MainLayout ?? module?.default
        : module?.default;
      if (!isReactComponent(component)) {
        throw new TypeError('Component module must export a React component');
      }
      return component;
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
      if (!isPlainObject(newVersion)) return false;
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
          if (perfTimers.size >= MAX_PERF_TIMERS && !perfTimers.has(label)) {
            const oldest = perfTimers.keys().next().value;
            if (oldest !== undefined) perfTimers.delete(oldest);
          }
          perfTimers.set(label, performance.now());
        }
      : () => {};
    const perfEnd = DEBUG
      ? (label) => {
          const start = perfTimers.get(label);
          if (!start) return 0;

          const duration = performance.now() - start;
          perfTimers.delete(label);
          const safeLabel = String(label).replace(/[?#].*$/, '').slice(0, 256);
          console.log(
            '[Veryfront Perf] %c' + safeLabel + ': %c' + duration.toFixed(2) + 'ms',
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
        path: getSafeRoutePath(path),
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
    let pageDataCacheBytes = 0;

    function getCachedPageData(path) {
      const entry = pageDataCache.get(path);
      if (!entry) return null;

      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        pageDataCache.delete(path);
        pageDataCache.set(path, entry);
        return entry.data;
      }

      pageDataCache.delete(path);
      pageDataCacheBytes -= entry.size;
      backgroundRefreshTimestamps.delete(path);
      return null;
    }

    function setCachedPageData(path, data, size) {
      const existing = pageDataCache.get(path);
      if (existing) {
        pageDataCache.delete(path);
        pageDataCacheBytes -= existing.size;
      }

      if (size > MAX_PAGE_DATA_CACHE_BYTES) return;
      while (
        pageDataCache.size >= MAX_CACHE_SIZE ||
        pageDataCacheBytes + size > MAX_PAGE_DATA_CACHE_BYTES
      ) {
        const oldest = pageDataCache.keys().next().value;
        if (!oldest) break;
        const oldestEntry = pageDataCache.get(oldest);
        pageDataCache.delete(oldest);
        pageDataCacheBytes -= oldestEntry?.size || 0;
        backgroundRefreshTimestamps.delete(oldest);
      }

      pageDataCache.set(path, { data, size, timestamp: Date.now() });
      pageDataCacheBytes += size;
    }

    function setBackgroundRefreshTimestamp(path, timestamp) {
      backgroundRefreshTimestamps.delete(path);
      while (backgroundRefreshTimestamps.size >= MAX_BACKGROUND_REFRESH_TIMESTAMPS) {
        const oldest = backgroundRefreshTimestamps.keys().next().value;
        if (oldest === undefined) break;
        backgroundRefreshTimestamps.delete(oldest);
      }
      backgroundRefreshTimestamps.set(path, timestamp);
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
    let progressCompletionTimeout = null;
    let progressResetTimeout = null;

    function clearProgressCompletionTimers() {
      if (progressCompletionTimeout !== null) {
        clearTimeout(progressCompletionTimeout);
        progressCompletionTimeout = null;
      }
      if (progressResetTimeout !== null) {
        clearTimeout(progressResetTimeout);
        progressResetTimeout = null;
      }
    }

    function showNavigationProgress() {
      clearProgressCompletionTimers();
      if (progressTimeout) {
        clearTimeout(progressTimeout);
        progressTimeout = null;
      }
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
      clearProgressCompletionTimers();
      if (progressTimeout) {
        clearTimeout(progressTimeout);
        progressTimeout = null;
      }

      if (progressBar) {
        progressBar.style.width = '100%';
        progressCompletionTimeout = setTimeout(() => {
          progressCompletionTimeout = null;
          if (!progressBar) return;

          progressBar.style.opacity = '0';
          progressResetTimeout = setTimeout(() => {
            progressResetTimeout = null;
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

    function createAbortError() {
      return new DOMException('The operation was aborted', 'AbortError');
    }

    function throwIfAborted(signal) {
      if (signal?.aborted) throw createAbortError();
    }

    function sleep(ms, signal) {
      throwIfAborted(signal);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        }, ms);
        const onAbort = () => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', onAbort);
          reject(createAbortError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }

    async function waitForHydration(signal) {
      if (hydrationCompleted || hydrationFailed) return;
      throwIfAborted(signal);

      let timeout;
      let onAbort;
      const timeoutOrAbort = new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Hydration timeout')),
          FETCH_TIMEOUT_MS
        );
        onAbort = () => reject(createAbortError());
        signal?.addEventListener('abort', onAbort, { once: true });
      });

      try {
        await Promise.race([hydrationPromise, timeoutOrAbort]);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    }

    async function fetchWithRetry(url, options = {}, maxRetries = MAX_RETRIES) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        throwIfAborted(options.signal);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const abortFromCaller = () => controller.abort();
        options.signal?.addEventListener('abort', abortFromCaller, { once: true });

        try {
          const response = await fetch(url, { ...options, signal: controller.signal });

          if (response.ok) return response;

          if (response.status >= 500 && attempt < maxRetries) {
            log('Server error, retrying...', response.status);
            await sleep(Math.pow(2, attempt) * 500, options.signal);
            continue;
          }

          return response;
        } catch (error) {
          if (options.signal?.aborted) throw createAbortError();
          if (attempt === maxRetries) throw error;

          log('Fetch failed, retrying (' + getErrorName(error) + ')');
          await sleep(Math.pow(2, attempt) * 500, options.signal);
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener('abort', abortFromCaller);
        }
      }
    }

    // ============================================
    // Page data fetching with caching
    // ============================================
    async function readPageDataResponse(response, signal) {
      const contentLength = Number(response.headers?.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_PAGE_DATA_BYTES) {
        throw new TypeError('Page data response exceeds the size limit');
      }

      const reader = response.body?.getReader?.();
      if (!reader) {
        const text = await response.text();
        const size = new TextEncoder().encode(text).byteLength;
        if (size > MAX_PAGE_DATA_BYTES) {
          throw new TypeError('Page data response exceeds the size limit');
        }
        return { text, size };
      }

      const decoder = new TextDecoder();
      let text = '';
      let size = 0;
      let timedOut = false;
      const cancelReader = () => {
        try {
          const cancellation = reader.cancel();
          cancellation?.catch?.(() => {});
        } catch (_) {
          // Reader cancellation is best-effort after a terminal validation failure.
        }
      };
      const onAbort = () => cancelReader();
      const timeout = setTimeout(() => {
        timedOut = true;
        cancelReader();
      }, FETCH_TIMEOUT_MS);
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        while (true) {
          const chunk = await reader.read();
          if (signal?.aborted) throw createAbortError();
          if (timedOut) throw new Error('Page data response timed out');
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) {
            throw new TypeError('Page data response contained an invalid byte chunk');
          }
          size += chunk.value.byteLength;
          if (size > MAX_PAGE_DATA_BYTES) {
            cancelReader();
            throw new TypeError('Page data response exceeds the size limit');
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
        return { text, size };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        reader.releaseLock?.();
      }
    }

    async function fetchPageDataFresh(path, signal, options = {}) {
      const {
        triggerReloadOnVersionMismatch = false,
        recordRouteTiming = false,
        timingSource = 'network'
      } = options;
      const navigationUrl = getInternalNavigationUrl(path);
      const normalizedPath = navigationUrl.pathname === '/'
        ? 'index'
        : navigationUrl.pathname.replace(/^\\//, '');
      const endpoint = '/_veryfront/page-data/' + normalizedPath + '.json' + navigationUrl.search;
      const startedAt = recordRouteTiming ? routeTimingNow() : 0;

      const safePath = getSafeRoutePath(path);
      log('Fetching page data:', safePath);
      perfStart('fetch:' + safePath);

      const response = await fetchWithRetry(endpoint, {
        headers: { 'X-Veryfront-Navigation': 'spa' },
        signal
      });

      if (!response.ok) {
        perfEnd('fetch:' + safePath);
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

      perfStart('parse:' + safePath);
      const { text: responseText, size: responseSize } =
        await readPageDataResponse(response, signal);
      const data = assertValidPageData(JSON.parse(responseText));
      perfEnd('parse:' + safePath);
      perfEnd('fetch:' + safePath);
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

      setCachedPageData(path, data, responseSize);
      return data;
    }

    function handlePageDataVersionMismatch(path, data) {
      if (data.buildVersion && checkVersionMismatch(data.buildVersion)) {
        log('Version mismatch detected, performing full page reload to:', getSafeRoutePath(path));
        window.location.href = path;
        return new Promise(() => {});
      }

      return data;
    }

    function startPageDataFetch(path, signal, options = {}) {
      if (
        !pendingPageDataFetches.has(path) &&
        pendingPageDataFetches.size >= MAX_PENDING_PAGE_DATA_FETCHES
      ) {
        return Promise.reject(new Error('Page data concurrency limit reached'));
      }
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

      setBackgroundRefreshTimestamp(path, now);
      fetchPageDataDeduped(path).catch((error) => {
        logBackgroundFetchFailure('Stale page data refresh', path, error);
      });
    }

    async function fetchPageDataForNavigation(path, signal) {
      const startedAt = routeTimingNow();
      const cached = getCachedPageData(path);
      if (cached) {
        log('Using cached page data:', getSafeRoutePath(path));
        refreshPageDataInBackground(path);
        emitRouteTiming('page-data', path, startedAt, { source: 'cache' });
        return cached;
      }

      const pending = pendingPageDataFetches.get(path);
      if (pending) {
        log('Reusing pending page data fetch for navigation:', getSafeRoutePath(path));
        try {
          const data = await pending;
          emitRouteTiming('page-data', path, startedAt, { source: 'deduped' });
          return handlePageDataVersionMismatch(path, data);
        } catch (error) {
          if (signal?.aborted || getErrorName(error) !== 'AbortError') throw error;
        }
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
    let currentPath = window.location.pathname + window.location.search;
    let isNavigating = false;
    let navigationSequence = 0;

    // ============================================
    // SPA navigation handler
    // ============================================
    async function navigateSPA(
      href,
      pushState = true,
      restoreScroll = false,
      replaceState = false
    ) {
      let navigationUrl;
      try {
        navigationUrl = getInternalNavigationUrl(href);
      } catch (error) {
        logError('SPA navigation rejected (' + getErrorName(error) + ')');
        return;
      }

      const targetRouteHref = navigationUrl.pathname + navigationUrl.search;
      const normalizedHref = targetRouteHref + navigationUrl.hash;
      const targetPathname = navigationUrl.pathname;
      const navigationId = ++navigationSequence;
      currentAbortController?.abort();
      isNavigating = true;

      const controller = new AbortController();
      currentAbortController = controller;
      const signal = controller.signal;
      const navigationStartedAt = routeTimingNow();

      showNavigationProgress();
      perfStart('nav:total:' + targetRouteHref);

      try {
        log('SPA navigating to:', getSafeRoutePath(targetRouteHref));

        saveScrollPosition(currentPath);

        perfStart('nav:fetchData:' + targetRouteHref);
        const pageData = await fetchPageDataForNavigation(targetRouteHref, signal);
        perfEnd('nav:fetchData:' + targetRouteHref);

        if (signal.aborted) return;

        if (pushState) {
          window.history.pushState({ pageData, scrollY: 0 }, '', normalizedHref);
        } else if (replaceState) {
          window.history.replaceState({ pageData, scrollY: 0 }, '', normalizedHref);
        }

        // Update the shared router snapshot BEFORE rendering. RouterProvider
        // reads router.params during render, so mutating after renderPageFromData
        // would leave the new page's first render with the previous route's
        // params (issue #2741). pathname/query move up for the same reason.
        currentPath = targetRouteHref;
        window.__veryfrontRouter.path = targetPathname;
        window.__veryfrontRouter.pathname = targetPathname;
        window.__veryfrontRouter.query = Object.fromEntries(navigationUrl.searchParams);
        window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);

        perfStart('nav:render:' + targetRouteHref);
        await renderPageFromData(pageData, targetPathname, signal);
        perfEnd('nav:render:' + targetRouteHref);

        if (signal.aborted) return;

        if (restoreScroll) {
          restoreScrollPosition(targetRouteHref);
        } else if (navigationUrl.hash) {
          requestAnimationFrame(() => {
            let hashTarget = navigationUrl.hash.slice(1);
            try {
              hashTarget = decodeURIComponent(hashTarget);
            } catch (_) {
              // Keep the original fragment when it is not valid percent encoding.
            }
            const target = document.getElementById(hashTarget);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth' });
              return;
            }
            window.scrollTo(0, 0);
          });
        } else {
          window.scrollTo(0, 0);
        }

        if (navigationId === navigationSequence) hideNavigationProgress();
        perfEnd('nav:total:' + targetRouteHref);
        emitRouteTiming('total', targetPathname, navigationStartedAt, {
          pushState,
          restoreScroll
        });
        log('SPA navigation complete');
      } catch (error) {
        if (navigationId === navigationSequence) hideNavigationProgress();

        if (getErrorName(error) === 'AbortError') {
          log('Navigation aborted');
          return;
        }

        logError('SPA navigation failed (' + getErrorName(error) + ')');

        if (error.status === 404) {
          logError('Page not found:', getSafeRoutePath(targetPathname));
        }

        window.location.href = normalizedHref;
      } finally {
        if (navigationId === navigationSequence) {
          isNavigating = false;
          if (currentAbortController === controller) currentAbortController = null;
        }
      }
    }

    // ============================================
    // Render page from page data
    // ============================================
    async function loadPageDataComponent(pageData, path) {
      assertSafeModulePath(path);
      if (!pageData.isolatedClientPage) return loadComponent(path);
      if (typeof path !== 'string' || !path || path.length > MAX_ROUTE_HREF_LENGTH) {
        throw new TypeError('Page module path is invalid');
      }

      const moduleUrl = '/_veryfront/rsc/module?rel=' + encodeURIComponent(path);
      const module = await import(moduleUrl);
      return selectComponentExport(module, path);
    }

    async function renderPageFromData(pageData, targetPath, signal) {
      throwIfAborted(signal);
      pageData = assertValidPageData(pageData);
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
      throwIfAborted(signal);
      emitRouteTiming('modules', targetPath, modulesStartedAt, { count: allPaths.length });
      perfEnd('render:loadAll');

      const [PageComponent, ...rest] = components;
      const AppComponent = pageData.appPath ? rest.pop() : null;
      const LayoutComponents = rest;

      if (!PageComponent) {
        throw new Error('Failed to load page component');
      }
      if (LayoutComponents.some((component) => !component)) {
        throw new Error('Layout component failed to load');
      }
      if (pageData.appPath && !AppComponent) {
        throw new Error('App component failed to load');
      }

      if (typeof pageData.frontmatter?.title === 'string') {
        document.title = pageData.frontmatter.title;
      }

      if (typeof pageData.frontmatter?.description === 'string') {
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

          const layoutProps = pageData.layoutProps &&
              Object.prototype.hasOwnProperty.call(pageData.layoutProps, layout.path)
            ? pageData.layoutProps[layout.path]
            : {};
          tree = React.createElement(LayoutComponent, { ...layoutProps, children: tree });
        }
      }

      if (AppComponent) {
        tree = React.createElement(AppComponent, { children: tree });
        log('Wrapped with App component for SPA navigation');
      }

      const headingsArray = Array.isArray(pageData.headings) ? pageData.headings : [];
      const pageContext = {
        slug: pageData.slug || '',
        path: pageData.pagePath || targetPath,
        params: normalizedParams,
        query: { ...window.__veryfrontRouter.query },
        frontmatter: pageData.frontmatter || {},
        headings: headingsArray,
        mdxHeadings: headingsArray
      };

      tree = React.createElement(PageContextProvider, { pageContext, children: tree });
      tree = React.createElement(RouterProvider, { router, children: tree });

      const container = pageData.isolatedClientPage
        ? document.getElementById('veryfront-page-island')
        : document.getElementById('root');

      if (!hydrationCompleted && !hydrationFailed) {
        log('Waiting for hydration to complete before SPA render...');
        try {
          await waitForHydration(signal);
        } catch (waitError) {
          if (getErrorName(waitError) === 'AbortError') throw waitError;
          log('Hydration wait failed (' + getErrorName(waitError) + ')');
        }
      }

      throwIfAborted(signal);

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

      const uniquePaths = [...new Set(allPaths)];
      if (uniquePaths.length > MAX_PAGE_MODULES) {
        throw new TypeError('Page data contains too many module paths');
      }
      for (const path of uniquePaths) {
        if (typeof path !== 'string' || !path || path.length > MAX_ROUTE_HREF_LENGTH) {
          throw new TypeError('Page data contains an invalid module path');
        }
        assertSafeModulePath(path);
      }
      return uniquePaths;
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
        const url = getInternalNavigationUrl(href);

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
      pageData = assertValidPageData(pageData);

      const modulePaths = getPageDataModulePaths(pageData);
      if (modulePaths.length === 0) return;

      try {
        if (pageData.isolatedClientPage) {
          await Promise.all(
            modulePaths.map((modulePath) => loadPageDataComponent(pageData, modulePath))
          );
          return;
        }

        // Resolve target URLs while its release map is active, then restore the
        // current page immediately. componentLoader.loadComponent resolves the
        // URL synchronously before returning its import promise.
        const componentLoader = await getComponentLoader();
        if (isNavigating) return;
        const previousReleaseId = window.__veryfrontReleaseId || null;
        const previousReleaseAssetModules = window.__veryfrontReleaseAssetModules || null;
        let loads;
        try {
          window.__veryfrontSetReleaseId?.(pageData.releaseId || null);
          window.__veryfrontSetReleaseAssetModules?.(pageData.releaseAssetModules || null);
          loads = modulePaths.map((modulePath) => {
            assertSafeModulePath(modulePath);
            return componentLoader.loadComponent(modulePath);
          });
        } finally {
          window.__veryfrontSetReleaseId?.(previousReleaseId);
          window.__veryfrontSetReleaseAssetModules?.(previousReleaseAssetModules);
        }
        await Promise.all(loads);
      } catch (error) {
        logBackgroundFetchFailure('Module prefetch', path, error);
      }
    }

    function prefetchPage(href) {
      if (isNavigating) return;
      if (prefetchedPaths.has(href) || inFlightPrefetches.has(href)) return;
      if (inFlightPrefetches.size >= MAX_IN_FLIGHT_PREFETCHES) return;

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

      observer.disconnect();

      for (const { link } of getEligiblePrefetchLinks(VIEWPORT_PREFETCH_MAX_LINKS)) {
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
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
      for (const key of Object.keys(raw).slice(0, 100)) {
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;
        const value = raw[key];
        if (value === undefined) continue;
        if (typeof value === 'string' && value.length <= MAX_ROUTE_HREF_LENGTH) {
          out[key] = value;
          continue;
        }
        if (
          Array.isArray(value) && value.length <= 100 &&
          value.every((item) => typeof item === 'string')
        ) {
          const joined = value.join('/');
          if (joined.length <= MAX_ROUTE_HREF_LENGTH) out[key] = joined;
        }
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
        void navigateSPA(path, true);
      },
      replace: (path) => {
        void navigateSPA(path, false, false, true);
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
      navigate: (path) => navigateSPA(path, true),
      reload: () => window.location.reload()
    };

    window.__veryfrontRouter = router;

    // ============================================
    // Event handlers
    // ============================================
    window.addEventListener('popstate', async (e) => {
      const path = window.location.pathname;
      const routeHref = path + window.location.search;
      log('Popstate:', getSafeRoutePath(path));

      saveScrollPosition(currentPath);

      if (!e.state?.pageData) {
        await navigateSPA(routeHref, false, true);
        return;
      }

      const popstateNavigationId = ++navigationSequence;
      currentAbortController?.abort();
      const popstateController = new AbortController();
      currentAbortController = popstateController;
      const popstateSignal = popstateController.signal;
      isNavigating = true;
      showNavigationProgress();
      try {
        const pageData = assertValidPageData(e.state.pageData);
        // Update the router snapshot before rendering so RouterProvider reads
        // this route's params, not the previous route's (issue #2741).
        currentPath = routeHref;
        window.__veryfrontRouter.path = path;
        window.__veryfrontRouter.pathname = path;
        window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));
        window.__veryfrontRouter.params = normalizeRouteParams(pageData.params);

        await renderPageFromData(pageData, path, popstateSignal);
        throwIfAborted(popstateSignal);

        restoreScrollPosition(routeHref);
        if (popstateNavigationId === navigationSequence) hideNavigationProgress();
      } catch (error) {
        if (popstateNavigationId === navigationSequence) hideNavigationProgress();
        if (getErrorName(error) === 'AbortError') return;
        logError('Popstate render failed (' + getErrorName(error) + ')');
        window.location.reload();
      } finally {
        if (popstateNavigationId === navigationSequence) {
          isNavigating = false;
          if (currentAbortController === popstateController) currentAbortController = null;
        }
      }
    });

    document.addEventListener('click', (e) => {
      if (
        e.defaultPrevented || e.button !== 0 || !e.target ||
        typeof e.target.closest !== 'function'
      ) return;
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
