export const getRouterScript = () => `
    // Use current origin for module server (modules are served by main dev server at /_vf_modules/)
    const MODULE_SERVER_URL = window.location.origin + '/_vf_modules';

    // SPA page data cache
    const pageDataCache = new Map();
    let currentPath = window.location.pathname;
    let isNavigating = false;

    // Fetch page data for SPA navigation
    async function fetchPageData(path) {
      if (pageDataCache.has(path)) {
        return pageDataCache.get(path);
      }

      const normalizedPath = path === '/' ? '' : path.replace(/^\\//, '');
      const endpoint = '/_veryfront/page-data/' + normalizedPath + '.json';

      console.log('[Veryfront Router] Fetching page data:', endpoint);

      const response = await fetch(endpoint, {
        headers: { 'X-Veryfront-Navigation': 'spa' }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch page data: ' + response.status);
      }

      const data = await response.json();
      pageDataCache.set(path, data);
      return data;
    }

    // SPA navigation handler
    async function navigateSPA(href, pushState = true) {
      if (isNavigating) return;
      isNavigating = true;

      try {
        console.log('[Veryfront Router] SPA navigating to:', href);

        // Fetch page data
        const pageData = await fetchPageData(href);

        // Update history
        if (pushState) {
          window.history.pushState({ pageData }, '', href);
        }

        // Load and render the new page
        await renderPageFromData(pageData);

        currentPath = href;
        window.__veryfrontRouter.pathname = href;

        // Scroll to top for new pages
        window.scrollTo(0, 0);

        console.log('[Veryfront Router] SPA navigation complete');
      } catch (error) {
        console.error('[Veryfront Router] SPA navigation failed, falling back:', error);
        // Fallback to full page navigation
        window.location.href = href;
      } finally {
        isNavigating = false;
      }
    }

    // Render page from page data
    async function renderPageFromData(pageData) {
      // Load the page component
      const PageComponent = await loadComponent(pageData.pagePath);
      if (!PageComponent) {
        throw new Error('Failed to load page component: ' + pageData.pagePath);
      }

      // Update document title
      if (pageData.frontmatter?.title) {
        document.title = pageData.frontmatter.title;
      }

      // Build the component tree with layouts
      let tree = React.createElement(PageComponent, {
        ...pageData.props,
        params: pageData.params
      });

      // Wrap with layouts (innermost to outermost)
      if (pageData.layouts && pageData.layouts.length > 0) {
        for (let i = pageData.layouts.length - 1; i >= 0; i--) {
          const layout = pageData.layouts[i];
          const LayoutComponent = await loadComponent(layout.path);
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
        container.__reactRoot.render(tree);
        console.log('[Veryfront Router] Page re-rendered via SPA');
      }
    }

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
      pathname: window.location.pathname,
      query: Object.fromEntries(new URLSearchParams(window.location.search))
    };

    window.__veryfrontRouter = router;

    // Handle browser back/forward
    window.addEventListener('popstate', async (e) => {
      const path = window.location.pathname;
      console.log('[Veryfront Router] Popstate:', path);

      if (e.state?.pageData) {
        // Use cached page data from history state
        await renderPageFromData(e.state.pageData);
        currentPath = path;
      } else {
        // Fetch fresh data
        await navigateSPA(path, false);
      }
    });

    // Intercept link clicks for SPA navigation
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      const href = link.getAttribute('href');
      if (!href) return;

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
