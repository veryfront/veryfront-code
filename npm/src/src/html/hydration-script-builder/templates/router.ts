export const getRouterScript = () => `
    // Use current origin for module server (modules are served by main dev server at /_vf_modules/)
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    // ============================================
    // Hydration state tracking
    // ============================================
    // Track when initial hydration completes to prevent race conditions with SPA navigation
    let hydrationResolve;
    let hydrationReject;
    const hydrationPromise = new Promise((resolve, reject) => {
      hydrationResolve = resolve;
      hydrationReject = reject;
    });
    let hydrationCompleted = false;
    let hydrationFailed = false;

    // Called by renderer.ts after successful hydration
    window.__veryfrontHydrationComplete = () => {
      hydrationCompleted = true;
      hydrationResolve();
      log('Hydration complete signal received');
    };

    // Called by renderer.ts if hydration fails
    window.__veryfrontHydrationFailed = (error) => {
      hydrationFailed = true;
      hydrationReject(error);
      logError('Hydration failed signal received:', error);
    };

    // ============================================
    // Configuration
    // ============================================
    // Enable debug via: ?vf_debug=1 or window.__VERYFRONT_DEBUG__ = true
    const DEBUG = window.__VERYFRONT_DEBUG__ || new URLSearchParams(window.location.search).has('vf_debug');
    const FETCH_TIMEOUT_MS = 10000;
    const MAX_RETRIES = 2;
    const MAX_CACHE_SIZE = 50;
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
    const PREFETCH_DELAY_MS = 100;
    const MAX_PREFETCH_PATHS = 100; // Limit prefetched paths to prevent memory leaks

    // ============================================
    // Debug logging (production-safe)
    // ============================================
    const log = DEBUG ? console.log.bind(console, '[Veryfront]') : () => {};
    const logError = console.error.bind(console, '[Veryfront]');

    // ============================================
    // Version tracking for cache invalidation
    // ============================================
    let clientBuildVersion = null; // Set on first page data fetch

    function checkVersionMismatch(newVersion) {
      if (!clientBuildVersion) {
        // First load - store the version
        clientBuildVersion = newVersion;
        log('Build version initialized:', newVersion);
        return false;
      }

      // Check for server restart (serverStart changed)
      if (newVersion.serverStart !== clientBuildVersion.serverStart) {
        log('Server restarted, reloading...', {
          old: clientBuildVersion.serverStart,
          new: newVersion.serverStart
        });
        return true;
      }

      // Check for framework update
      if (newVersion.framework !== clientBuildVersion.framework) {
        log('Framework version changed, reloading...', {
          old: clientBuildVersion.framework,
          new: newVersion.framework
        });
        return true;
      }

      // Check for project content update (if available)
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

    // ============================================
    // LRU Cache with TTL (single Map to prevent sync issues)
    // ============================================
    const pageDataCache = new Map(); // Map<string, { data: object, timestamp: number }>

    function getCachedPageData(path) {
      const entry = pageDataCache.get(path);
      if (!entry) return null;

      if (Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data;

      // Expired - remove from cache
      pageDataCache.delete(path);
      return null;
    }

    function setCachedPageData(path, data) {
      // LRU eviction if at capacity
      if (pageDataCache.size >= MAX_CACHE_SIZE) {
        const oldest = pageDataCache.keys().next().value;
        if (oldest) pageDataCache.delete(oldest);
      }

      pageDataCache.set(path, { data, timestamp: Date.now() });
    }

    // ============================================
    // Scroll position memory (bounded)
    // ============================================
    const MAX_SCROLL_POSITIONS = 100;
    const scrollPositions = new Map();

    function saveScrollPosition(path) {
      // LRU eviction if at capacity
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

      // Animate to 70% over time
      progressTimeout = setTimeout(() => {
        if (progressBar) progressBar.style.width = '70%';
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

          // Retry on 5xx errors
          if (response.status >= 500 && attempt < maxRetries) {
            log('Server error, retrying...', response.status);
            await sleep(Math.pow(2, attempt) * 500); // 500ms, 1s, 2s
            continue;
          }

          // Return 4xx as-is (don't retry client errors)
          return response;
        } catch (error) {
          clearTimeout(timeout);

          // Don't retry if aborted by user navigation
          if (error.name === 'AbortError' && options.signal?.aborted) {
            throw error;
          }

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
      const { triggerReloadOnVersionMismatch = false } = options;
      const normalizedPath = path === '/' ? '' : path.replace(/^\\//, '');
      const endpoint = '/_veryfront/page-data/' + normalizedPath + '.json';

      log('Fetching page data:', path);
      perfStart('fetch:' + path);

      const response = await fetchWithRetry(endpoint, {
        headers: { 'X-Veryfront-Navigation': 'spa' },
        signal
      });

      if (!response.ok) {
        perfEnd('fetch:' + path);
        const error = new Error('Failed to fetch page data: ' + response.status);
        error.status = response.status;
        throw error;
      }

      perfStart('parse:' + path);
      const data = await response.json();
      perfEnd('parse:' + path);
      perfEnd('fetch:' + path);

      // Check for version mismatch - only trigger reload during actual navigation
      if (triggerReloadOnVersionMismatch && data.buildVersion && checkVersionMismatch(data.buildVersion)) {
        log('Version mismatch detected, performing full page reload to:', path);
        window.location.href = path;
        // Return a promise that never resolves since we're reloading
        return new Promise(() => {});
      }

      setCachedPageData(path, data);
      return data;
    }

    // Fetch for navigation (triggers reload on version mismatch)
    async function fetchPageDataForNavigation(path, signal) {
      const cached = getCachedPageData(path);
      if (cached) {
        log('Using cached page data:', path);
        // Revalidate in background (no reload trigger)
        fetchPageDataFresh(path, null).catch(() => { /* SILENT: background revalidation is best-effort */ });
        return cached;
      }

      return fetchPageDataFresh(path, signal, { triggerReloadOnVersionMismatch: true });
    }

    // Fetch for prefetch (no reload trigger - just cache the data)
    async function fetchPageDataForPrefetch(path) {
      if (getCachedPageData(path)) return;
      return fetchPageDataFresh(path, null).catch(() => { /* SILENT: prefetch is best-effort */ });
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
      // Cancel any pending navigation
      currentAbortController?.abort();

      // Prevent concurrent navigations
      if (isNavigating) return;
      isNavigating = true;

      // Create new abort controller for this navigation
      currentAbortController = new AbortController();
      const signal = currentAbortController.signal;

      showNavigationProgress();
      perfStart('nav:total:' + href);

      try {
        log('SPA navigating to:', href);

        // Save current scroll position before navigating
        saveScrollPosition(currentPath);

        // Parse href for path and hash
        const [path, hash] = href.split('#');
        const targetPath = path || currentPath;

        // Fetch page data (triggers reload on version mismatch)
        perfStart('nav:fetchData:' + href);
        const pageData = await fetchPageDataForNavigation(targetPath, signal);
        perfEnd('nav:fetchData:' + href);

        // Check if navigation was aborted
        if (signal.aborted) return;

        // Update history
        if (pushState) {
          window.history.pushState({ pageData, scrollY: 0 }, '', href);
        }

        // Load and render the new page
        perfStart('nav:render:' + href);
        await renderPageFromData(pageData, targetPath);
        perfEnd('nav:render:' + href);

        currentPath = targetPath;
        window.__veryfrontRouter.pathname = targetPath;
        window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));

        // Handle scrolling
        if (restoreScroll) {
          restoreScrollPosition(targetPath);
        } else if (hash) {
          // Scroll to hash target
          requestAnimationFrame(() => {
            const target = document.getElementById(hash);
            if (target) {
              target.scrollIntoView({ behavior: 'smooth' });
            } else {
              window.scrollTo(0, 0);
            }
          });
        } else {
          window.scrollTo(0, 0);
        }

        hideNavigationProgress();
        perfEnd('nav:total:' + href);
        log('SPA navigation complete');
      } catch (error) {
        hideNavigationProgress();

        // Ignore abort errors from user-initiated navigation cancellation
        if (error.name === 'AbortError') {
          log('Navigation aborted');
          return;
        }

        logError('SPA navigation failed:', error.message);

        // For 404 errors, could show a custom error page
        // For other errors, fallback to full page navigation
        if (error.status === 404) {
          logError('Page not found:', href);
        }

        // Fallback to full page navigation
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
      // Load page, layouts, and app components in PARALLEL for faster cold start
      perfStart('render:loadAll');
      const layoutPaths = (pageData.layouts || []).map((l) => l.path);
      const allPaths = [pageData.pagePath, ...layoutPaths];

      // Also load App component if available (contains QueryClientProvider, ThemeProvider, etc.)
      if (pageData.appPath) allPaths.push(pageData.appPath);

      const components = await Promise.all(allPaths.map((path) => loadComponent(path)));
      perfEnd('render:loadAll');

      const [PageComponent, ...rest] = components;
      // Split off App component if we loaded it
      const AppComponent = pageData.appPath ? rest.pop() : null;
      const LayoutComponents = rest;

      if (!PageComponent) {
        throw new Error('Failed to load page component: ' + pageData.pagePath);
      }

      // Update document title
      if (pageData.frontmatter?.title) {
        document.title = pageData.frontmatter.title;
      }

      // Update meta description if present
      if (pageData.frontmatter?.description) {
        const metaDesc = document.querySelector('meta[name="description"]');
        metaDesc?.setAttribute('content', pageData.frontmatter.description);
      }

      // Inject CSS for the new page (ensures styles work without Tailwind CDN)
      if (pageData.css) {
        const existingStyle = document.getElementById('veryfront-spa-css');
        if (existingStyle) {
          // Update existing style element content
          existingStyle.textContent = pageData.css;
        } else {
          // Create new style element
          const styleEl = document.createElement('style');
          styleEl.id = 'veryfront-spa-css';
          styleEl.textContent = pageData.css;
          document.head.appendChild(styleEl);
        }
        log('Injected CSS for SPA navigation', { cssLength: pageData.css.length });
      }

      // Build the component tree with layouts
      let tree = React.createElement(PageComponent, {
        ...pageData.props,
        params: pageData.params
      });

      // Wrap with layouts (innermost to outermost) - components already loaded
      if (pageData.layouts?.length) {
        for (let i = pageData.layouts.length - 1; i >= 0; i--) {
          const layout = pageData.layouts[i];
          const LayoutComponent = LayoutComponents[i];
          if (!LayoutComponent) continue;

          const layoutProps = pageData.layoutProps?.[layout.path] || {};
          tree = React.createElement(LayoutComponent, { ...layoutProps, children: tree });
        }
      }

      // Wrap with App component if available (contains QueryClientProvider, ThemeProvider, etc.)
      if (AppComponent) {
        tree = React.createElement(AppComponent, { children: tree });
        log('Wrapped with App component for SPA navigation');
      }

      // Build page context for usePageContext() hook
      const headingsArray = pageData.headings || [];
      const pageContext = {
        slug: pageData.slug || '',
        path: pageData.pagePath || targetPath,
        params: pageData.params || {},
        query: Object.fromEntries(new URLSearchParams(window.location.search)),
        frontmatter: pageData.frontmatter || {},
        headings: headingsArray,
        mdxHeadings: headingsArray // Alias for backwards compatibility
      };

      // Wrap with PageContextProvider so layout components can access frontmatter
      tree = React.createElement(PageContextProvider, { pageContext, children: tree });

      // Wrap with providers - use imported RouterProvider with client router
      tree = React.createElement(RouterProvider, { router, children: tree });

      // Get the container and render
      const container = document.getElementById('veryfront-content');

      // Wait for hydration if it hasn't completed yet
      if (!hydrationCompleted && !hydrationFailed) {
        log('Waiting for hydration to complete before SPA render...');
        try {
          // Wait up to 10 seconds for hydration
          await Promise.race([
            hydrationPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Hydration timeout')), 10000))
          ]);
        } catch (waitError) {
          log('Hydration wait failed:', waitError.message);
          // Fall through to check container.__reactRoot below
        }
      }

      if (container?.__reactRoot) {
        perfStart('render:reactRender');
        container.__reactRoot.render(tree);
        perfEnd('render:reactRender');
        log('Page re-rendered via SPA');
        return;
      }

      if (hydrationFailed) {
        // Hydration failed, fall back to full page navigation
        throw new Error('React root not found - hydration failed, falling back to full page navigation');
      }

      throw new Error('React root not found');
    }

    // ============================================
    // Prefetching on hover (page data only, no module preloading)
    // ============================================
    let prefetchTimeout = null;
    const prefetchedPaths = new Set();
    const inFlightPrefetches = new Set(); // Track in-flight prefetch requests

    function prefetchPage(href) {
      // Skip if already prefetched, cached, or currently fetching
      if (prefetchedPaths.has(href) || getCachedPageData(href) || inFlightPrefetches.has(href)) return;

      // LRU eviction if at capacity - clear oldest entries
      if (prefetchedPaths.size >= MAX_PREFETCH_PATHS) {
        const oldest = prefetchedPaths.values().next().value;
        if (oldest) prefetchedPaths.delete(oldest);
      }

      prefetchedPaths.add(href);
      inFlightPrefetches.add(href);

      // Prefetch page data only (no reload on version mismatch)
      fetchPageDataForPrefetch(href)
        .catch(() => {
          // Silently fail prefetch
          prefetchedPaths.delete(href);
        })
        .finally(() => {
          inFlightPrefetches.delete(href);
        });
    }

    // ============================================
    // Router object
    // ============================================
    const router = {
      domain: window.location.origin,
      path: window.location.pathname,
      push: (path) => {
        navigateSPA(path, true);
      },
      replace: (path) => {
        navigateSPA(path, false);
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
      params: {},
      isPreview: false,
      isMounted: true,
      navigate: (path) => navigateSPA(path, true),
      reload: () => window.location.reload()
    };

    window.__veryfrontRouter = router;

    // ============================================
    // Event handlers
    // ============================================

    // Handle browser back/forward
    window.addEventListener('popstate', async (e) => {
      const path = window.location.pathname;
      log('Popstate:', path);

      // Save scroll position of page we're leaving
      saveScrollPosition(currentPath);

      if (!e.state?.pageData) {
        // Fetch fresh data with scroll restoration
        await navigateSPA(path, false, true);
        return;
      }

      // Use cached page data from history state
      showNavigationProgress();
      try {
        await renderPageFromData(e.state.pageData, path);
        currentPath = path;
        window.__veryfrontRouter.pathname = path;
        window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));

        // Restore scroll position
        restoreScrollPosition(path);
        hideNavigationProgress();
      } catch (error) {
        hideNavigationProgress();
        logError('Popstate render failed:', error.message);
        window.location.reload();
      }
    });

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

      // Handle hash-only links (scroll to element on same page)
      if (href.startsWith('#')) {
        const target = document.getElementById(href.slice(1));
        if (!target) return;

        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth' });
        window.history.pushState(null, '', href);
        return;
      }

      // Skip: external links, new tab, download, modifier keys, non-path links
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
      navigateSPA(href, true);
    });

    // Prefetch on hover (with debounce)
    // Track which link we're currently hovering to avoid duplicate work
    let currentHoverLink = null;

    document.addEventListener(
      'mouseenter',
      (e) => {
        if (!e.target || typeof e.target.closest !== 'function') return;
        const link = e.target.closest('a[href]');
        if (!link) return;

        const href = link.getAttribute('href');
        if (!href?.startsWith('/') || href.startsWith('//')) return;

        // If we're already tracking this link, don't restart the timeout
        if (currentHoverLink === link) return;

        // Clear any existing timeout before setting a new one
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

        // Only clear timeout if we're actually leaving the link entirely
        // Check if the mouse is moving to an element outside the current hover link
        const relatedTarget = e.relatedTarget;
        if (currentHoverLink && relatedTarget && currentHoverLink.contains(relatedTarget)) return;

        // Actually leaving the link
        if (prefetchTimeout) {
          clearTimeout(prefetchTimeout);
          prefetchTimeout = null;
        }
        currentHoverLink = null;
      },
      true
    );

    // ============================================
    // Router hooks - use imported RouterProvider from veryfront/router
    // This ensures the same component instance is used for SSR and client hydration
    // ============================================
    // window.useRouter uses the imported hook but falls back to global router for non-React usage
    window.useRouter = () => {
      try {
        // Try to use the React hook from the module (for React components)
        return useRouterFromModule();
      } catch {
        // Fall back to global router for non-React contexts
        return window.__veryfrontRouter;
      }
    };

    // RouterProvider is imported from 'veryfront/router' at the top of the script
    // When using it, pass the client router via the 'router' prop:
    //   React.createElement(RouterProvider, { router: router, children: tree })
`;
