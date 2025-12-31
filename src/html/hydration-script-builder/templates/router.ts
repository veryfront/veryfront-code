export const getRouterScript = () => `
    // Use current origin for module server (modules are served by main dev server at /_vf_modules/)
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

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

    // ============================================
    // Debug logging (production-safe)
    // ============================================
    const log = DEBUG ? console.log.bind(console, '[Veryfront]') : () => {};
    const logError = console.error.bind(console, '[Veryfront]');

    // ============================================
    // Performance timing (DEBUG only)
    // ============================================
    const perfTimers = new Map();
    const perfStart = DEBUG ? (label) => {
      perfTimers.set(label, performance.now());
    } : () => {};
    const perfEnd = DEBUG ? (label) => {
      const start = perfTimers.get(label);
      if (start) {
        const duration = performance.now() - start;
        perfTimers.delete(label);
        console.log('[Veryfront Perf] %c' + label + ': %c' + duration.toFixed(2) + 'ms',
          'color: #888', duration > 100 ? 'color: #f00; font-weight: bold' : 'color: #0a0');
        return duration;
      }
      return 0;
    } : () => 0;

    // ============================================
    // LRU Cache with TTL (single Map to prevent sync issues)
    // ============================================
    const pageDataCache = new Map(); // Map<string, { data: object, timestamp: number }>

    function getCachedPageData(path) {
      const entry = pageDataCache.get(path);
      if (!entry) return null;

      if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
        return entry.data;
      }

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
      if (savedY !== undefined) {
        requestAnimationFrame(() => window.scrollTo(0, savedY));
        return true;
      }
      return false;
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
        progressBar.style.cssText = 'position:fixed;top:0;left:0;height:3px;width:0;background:linear-gradient(90deg,#0066ff,#00aaff);z-index:99999;transition:width 0.3s ease-out,opacity 0.2s;opacity:1;';
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

    function hideNavigationProgress(success = true) {
      if (progressTimeout) {
        clearTimeout(progressTimeout);
        progressTimeout = null;
      }
      if (progressBar) {
        progressBar.style.width = '100%';
        setTimeout(() => {
          if (progressBar) {
            progressBar.style.opacity = '0';
            setTimeout(() => {
              if (progressBar) progressBar.style.width = '0';
            }, 200);
          }
        }, 150);
      }
      document.body.removeAttribute('aria-busy');
    }

    // ============================================
    // Fetch with timeout, retry, and abort support
    // ============================================
    let currentAbortController = null;

    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function fetchWithRetry(url, options, maxRetries = MAX_RETRIES) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        try {
          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });

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

          if (attempt === maxRetries) {
            throw error;
          }

          log('Fetch failed, retrying...', error.message);
          await sleep(Math.pow(2, attempt) * 500);
        }
      }
    }

    // ============================================
    // Page data fetching with caching
    // ============================================
    async function fetchPageDataFresh(path, signal) {
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

      setCachedPageData(path, data);
      return data;
    }

    async function fetchPageData(path, signal) {
      // Check cache first
      const cached = getCachedPageData(path);
      if (cached) {
        log('Using cached page data:', path);
        // Revalidate in background (stale-while-revalidate)
        fetchPageDataFresh(path, null).catch(() => {});
        return cached;
      }

      return fetchPageDataFresh(path, signal);
    }

    // ============================================
    // Navigation state
    // ============================================
    let currentPath = window.location.pathname;
    let isNavigating = false;

    // ============================================
    // SPA navigation handler
    // ============================================
    // Speculatively preload a module URL using link[rel=modulepreload]
    function speculativePreload(moduleUrl) {
      if (!moduleUrl || document.querySelector('link[href="' + moduleUrl + '"]')) return;
      const link = document.createElement('link');
      link.rel = 'modulepreload';
      link.href = moduleUrl;
      document.head.appendChild(link);
      log('Speculative preload:', moduleUrl);
    }

    // Infer likely page module URL from path
    function inferPageModuleUrl(path) {
      const normalizedPath = path === '/' ? '/index' : path;
      const slug = normalizedPath.replace(/^\//, '');
      // Try direct path first, then index
      return MODULE_SERVER_URL + '/pages/' + slug + '.js';
    }

    async function navigateSPA(href, pushState = true, restoreScroll = false) {
      // Cancel any pending navigation
      if (currentAbortController) {
        currentAbortController.abort();
      }

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

        // OPTIMIZATION: Start speculative module preloading immediately
        // while page data is being fetched (parallel loading)
        const likelyPageUrl = inferPageModuleUrl(targetPath);
        speculativePreload(likelyPageUrl);
        // Also try index variant for directory paths
        if (!targetPath.includes('.')) {
          speculativePreload(MODULE_SERVER_URL + '/pages/' + targetPath.replace(/^\//, '') + '/index.js');
        }

        // Fetch page data (runs in parallel with speculative preloads)
        perfStart('nav:fetchData:' + href);
        const pageData = await fetchPageData(targetPath, signal);
        perfEnd('nav:fetchData:' + href);

        // Check if navigation was aborted
        if (signal.aborted) {
          return;
        }

        // Update history
        if (pushState) {
          window.history.pushState({ pageData, scrollY: 0 }, '', href);
        }

        // Load and render the new page
        perfStart('nav:render:' + href);
        await renderPageFromData(pageData);
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

        hideNavigationProgress(true);
        perfEnd('nav:total:' + href);
        log('SPA navigation complete');
      } catch (error) {
        hideNavigationProgress(false);

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
    async function renderPageFromData(pageData) {
      // Load page and all layout components in PARALLEL for faster cold start
      perfStart('render:loadAll');
      const layoutPaths = (pageData.layouts || []).map(l => l.path);
      const allPaths = [pageData.pagePath, ...layoutPaths];

      const loadPromises = allPaths.map(path => loadComponent(path));
      const components = await Promise.all(loadPromises);
      perfEnd('render:loadAll');

      const [PageComponent, ...LayoutComponents] = components;

      if (!PageComponent) {
        throw new Error('Failed to load page component: ' + pageData.pagePath);
      }

      // Update document title
      if (pageData.frontmatter?.title) {
        document.title = pageData.frontmatter.title;
      }

      // Update meta description if present
      if (pageData.frontmatter?.description) {
        let metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) {
          metaDesc.setAttribute('content', pageData.frontmatter.description);
        }
      }

      // Build the component tree with layouts
      let tree = React.createElement(PageComponent, {
        ...pageData.props,
        params: pageData.params
      });

      // Wrap with layouts (innermost to outermost) - components already loaded
      if (pageData.layouts && pageData.layouts.length > 0) {
        for (let i = pageData.layouts.length - 1; i >= 0; i--) {
          const layout = pageData.layouts[i];
          const LayoutComponent = LayoutComponents[i];
          if (LayoutComponent) {
            const layoutProps = pageData.layoutProps?.[layout.path] || {};
            tree = React.createElement(LayoutComponent, { ...layoutProps, children: tree });
          }
        }
      }

      // Wrap with providers
      tree = React.createElement(RouterProvider, { children: tree });
      tree = React.createElement(QueryClientProviderWrapper, { children: tree });

      // Get the container and render
      const container = document.getElementById('veryfront-content');
      if (container && container.__reactRoot) {
        perfStart('render:reactRender');
        container.__reactRoot.render(tree);
        perfEnd('render:reactRender');
        log('Page re-rendered via SPA');
      } else {
        throw new Error('React root not found');
      }
    }

    // ============================================
    // Prefetching on hover
    // ============================================
    let prefetchTimeout = null;
    const prefetchedPaths = new Set();

    function prefetchPage(href) {
      if (prefetchedPaths.has(href) || getCachedPageData(href)) {
        return;
      }

      prefetchedPaths.add(href);

      // OPTIMIZATION: Start speculative module preload IMMEDIATELY
      // (don't wait for page data - predict likely module from URL)
      const likelyPageUrl = inferPageModuleUrl(href);
      speculativePreload(likelyPageUrl);
      if (!href.includes('.')) {
        speculativePreload(MODULE_SERVER_URL + '/pages/' + href.replace(/^\//, '') + '/index.js');
      }

      // Prefetch page data (runs in parallel with speculative preloads)
      fetchPageData(href, null).then(data => {
        // Preload the actual component module (if different from speculative)
        if (data?.pagePath) {
          const moduleUrl = MODULE_SERVER_URL + '/' + data.pagePath.replace(/\\.(tsx?|jsx?|mdx)$/, '.js');
          speculativePreload(moduleUrl);
        }
        // Also preload layouts
        if (data?.layouts) {
          for (const layout of data.layouts) {
            if (layout.path) {
              const layoutUrl = MODULE_SERVER_URL + '/' + layout.path.replace(/\\.(tsx?|jsx?|mdx)$/, '.js');
              speculativePreload(layoutUrl);
            }
          }
        }
      }).catch(() => {
        // Silently fail prefetch
        prefetchedPaths.delete(href);
      });
    }

    // ============================================
    // Router object
    // ============================================
    const router = {
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
      query: Object.fromEntries(new URLSearchParams(window.location.search))
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

      if (e.state?.pageData) {
        // Use cached page data from history state
        showNavigationProgress();
        try {
          await renderPageFromData(e.state.pageData);
          currentPath = path;
          window.__veryfrontRouter.pathname = path;
          window.__veryfrontRouter.query = Object.fromEntries(new URLSearchParams(window.location.search));

          // Restore scroll position
          restoreScrollPosition(path);
          hideNavigationProgress(true);
        } catch (error) {
          hideNavigationProgress(false);
          logError('Popstate render failed:', error.message);
          window.location.reload();
        }
      } else {
        // Fetch fresh data with scroll restoration
        await navigateSPA(path, false, true);
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
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth' });
          window.history.pushState(null, '', href);
        }
        return;
      }

      // Skip: external links, new tab, download, modifier keys, non-path links
      if (link.target === '_blank' ||
          link.hasAttribute('download') ||
          e.metaKey || e.ctrlKey || e.shiftKey || e.altKey ||
          !href.startsWith('/') ||
          href.startsWith('//')) {
        return;
      }

      e.preventDefault();
      navigateSPA(href, true);
    });

    // Prefetch on hover (with debounce)
    document.addEventListener('mouseenter', (e) => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href?.startsWith('/') || href.startsWith('//')) return;

      prefetchTimeout = setTimeout(() => {
        prefetchPage(href);
      }, PREFETCH_DELAY_MS);
    }, true);

    document.addEventListener('mouseleave', (e) => {
      if (!e.target || typeof e.target.closest !== 'function') return;
      const link = e.target.closest('a[href]');
      if (link && prefetchTimeout) {
        clearTimeout(prefetchTimeout);
        prefetchTimeout = null;
      }
    }, true);

    // ============================================
    // Router context and provider
    // ============================================
    const RouterContext = React.createContext(router);

    window.useRouter = () => {
      const ctx = React.useContext(RouterContext);
      if (!ctx) {
        return window.__veryfrontRouter;
      }
      return ctx;
    };

    const RouterProvider = ({ children }) => {
      return React.createElement(RouterContext.Provider, { value: router }, children);
    };
`;
