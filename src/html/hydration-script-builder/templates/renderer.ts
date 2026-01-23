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

      // Set studioEmbed flag for module loading (affects query params)
      if (data.studioEmbed && window.__veryfrontSetStudioEmbed) {
        window.__veryfrontSetStudioEmbed(true);
      }

      try {
        let pagePath;
        let pageModule;

        if (data.pagePath) {
          // Use the server-provided page path
          const moduleUrl = pathToModuleUrl(data.pagePath, data.studioEmbed);
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

        // Defensive null check - pageModule should always be defined here due to
        // fallback logic above, but check explicitly to prevent runtime crashes
        if (!pageModule) {
          logError('Page module failed to load');
          return;
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

        // Build page context for usePageContext() hook
        const headingsArray = data.headings || [];
        const pageContext = {
          slug: data.slug || '',
          path: data.pagePath || pathname,
          params: data.params || {},
          query: Object.fromEntries(new URLSearchParams(window.location.search)),
          frontmatter: data.frontmatter || {},
          headings: headingsArray,
          mdxHeadings: headingsArray, // Alias for backwards compatibility
        };

        // Wrap with PageContextProvider so layout components can access frontmatter
        tree = React.createElement(PageContextProvider, { pageContext, children: tree });

        // Use imported RouterProvider with client router for SPA navigation
        // The router object is defined in router.ts (same module scope)
        tree = React.createElement(RouterProvider, { router: router, children: tree });
        // Note: QueryClientProvider should be added by user's app.tsx if needed
        // This allows users to configure their own QueryClient options

        const container = document.getElementById('veryfront-content');
        if (container) {
          if (!container.__reactRoot) {
            // Always use hydrateRoot to preserve SSR content
            // IMPORTANT: identifierPrefix must match SSR to prevent useId() mismatch
            const { hydrateRoot } = await import('react-dom/client');
            // Always suppress recoverable hydration errors - they're common with animation
            // libraries that use useLayoutEffect and other SSR edge cases. React 18's
            // hydration recovers gracefully from mismatches. The SSR content is preserved
            // and client takes over interactivity.
            const options = {
              identifierPrefix: 'vf',
              onRecoverableError: (error) => {
                // Only log in dev mode with DEBUG enabled
                if (data.dev && typeof DEBUG !== 'undefined' && DEBUG) {
                  log('Hydration mismatch (suppressed):', error.message);
                }
              }
            };
            const root = hydrateRoot(container, tree, options);
            container.__reactRoot = root;
            log('Client-side React app hydrated successfully');
            // Signal hydration complete for SPA navigation
            if (window.__veryfrontHydrationComplete) {
              window.__veryfrontHydrationComplete();
            }
          } else {
            container.__reactRoot.render(tree);
            log('Page re-rendered');
          }
        }
      } catch (error) {
        logError('Client initialization error:', error);
        // Signal hydration failed for SPA navigation fallback
        if (window.__veryfrontHydrationFailed) {
          window.__veryfrontHydrationFailed(error);
        }
      }
    }

    // Expose renderPage for HMR to trigger re-render after module updates
    window.__veryfrontRenderPage = renderPage;

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
