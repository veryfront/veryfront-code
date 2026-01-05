export const getRendererScript = () => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    async function renderPage(pathname) {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        logError('Hydration data not found');
        return;
      }

      let data = {};
      try {
        data = JSON.parse(dataScript.textContent || '{}');
      } catch (parseError) {
        logError('Failed to parse hydration data:', parseError);
        return;
      }

      log('Hydration data:', data);

      try {
        let pagePath;
        let pageModule;

        if (data.pagePath) {
          // Use the server-provided page path
          const moduleUrl = pathToModuleUrl(data.pagePath);
          log('Loading page from hydration data:', moduleUrl);
          try {
            pageModule = await import(moduleUrl);
          } catch (error) {
            logError('Failed to load page from hydration data:', error);
          }
        }

        // Fallback to old Pages Router behavior if pagePath not available
        if (!pageModule) {
          const pageSlug = pathname === '/' ? 'index' : pathname.slice(1);
          log('Falling back to Pages Router pattern:', pageSlug);
          // Don't add pages/ prefix for @/ paths (alias paths like @/components/)
          const prefix = pageSlug.startsWith('@/') ? '' : '/pages';
          pagePath = MODULE_SERVER_URL + prefix + '/' + pageSlug + '.js';
          try {
            pageModule = await import(pagePath);
          } catch (err) {
            // Only try /index.js variant if slug is not already 'index' or ending with '/index'
            // e.g., 'about' -> 'about/index.js', but 'index' should NOT become 'index/index.js'
            if (pageSlug !== 'index' && !pageSlug.endsWith('/index')) {
              pagePath = MODULE_SERVER_URL + prefix + '/' + pageSlug + '/index.js';
              pageModule = await import(pagePath);
            } else {
              throw err; // Re-throw original error for index pages
            }
          }
        }

        const PageComponent = pageModule.default || pageModule;

        if (!PageComponent) {
          logError('Page component not found');
          return;
        }

        // Merge props with params for Next.js-style pages that expect { params }
        const pageProps = { ...(data.props || {}), params: data.params || {} };
        let tree = React.createElement(PageComponent, pageProps);

        if (data.layouts && data.layouts.length > 0) {
          for (let i = data.layouts.length - 1; i >= 0; i--) {
            const layout = data.layouts[i];
            const LayoutComponent = await loadComponent(layout.path);
            if (LayoutComponent) {
              tree = React.createElement(LayoutComponent, { children: tree });
            }
          }
        }

        if (data.appPath) {
          const AppComponent = await loadComponent(data.appPath);
          if (AppComponent) {
            tree = React.createElement(AppComponent, { children: tree });
          }
        }

        // Use imported RouterProvider with client router for SPA navigation
        // The router object is defined in router.ts (same module scope)
        tree = React.createElement(RouterProvider, { router: router, children: tree });
        // Note: QueryClientProvider should be added by user's app.tsx if needed
        // This allows users to configure their own QueryClient options

        const container = document.getElementById('veryfront-content');
        if (container) {
          if (!container.__reactRoot) {
            // Use hydrateRoot for initial render to preserve SSR content
            // This prevents flash/flicker when hydrating
            // IMPORTANT: identifierPrefix must match SSR to prevent useId() mismatch
            const { hydrateRoot } = await import('react-dom/client');
            const root = hydrateRoot(container, tree, { identifierPrefix: 'vf' });
            container.__reactRoot = root;
            log('Client-side React app hydrated successfully');
          } else {
            container.__reactRoot.render(tree);
            log('Page re-rendered');
          }
        }
      } catch (error) {
        logError('Client initialization error:', error);
      }
    }

    renderPage(window.location.pathname);

    // Store initial page data in history state for instant back navigation
    const initialDataScript = document.getElementById('veryfront-hydration-data');
    if (initialDataScript) {
      try {
        const pageData = JSON.parse(initialDataScript.textContent || '{}');
        if (pageData.pagePath) {
          window.history.replaceState({ pageData, scrollY: 0 }, '', window.location.href);
          log('Stored initial page data in history state');
        }
      } catch (e) { /* ignore parse errors */ }
    }

    // Note: popstate is handled by router.ts for SPA navigation
    // This file only handles initial page render
`;
