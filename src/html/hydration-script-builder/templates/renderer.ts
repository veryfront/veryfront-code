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
        let pageModule;

        if (data.pagePath) {
          const moduleUrl = pathToModuleUrl(data.pagePath, data.studioEmbed);
          log('Loading page from hydration data:', moduleUrl);

          try {
            pageModule = await import(moduleUrl);
          } catch (error) {
            logError('Failed to load page from hydration data:', error);
          }
        }

        if (!pageModule) {
          const pageSlug = pathname === '/' ? 'index' : pathname.slice(1);
          log('Falling back to Pages Router pattern:', pageSlug);

          const prefix = pageSlug.startsWith('@/') ? '' : '/pages';
          const basePath = MODULE_SERVER_URL + prefix + '/' + pageSlug;

          try {
            pageModule = await import(basePath + '.js');
          } catch (error) {
            if (pageSlug === 'index' || pageSlug.endsWith('/index')) throw error;
            pageModule = await import(basePath + '/index.js');
          }
        }

        if (!pageModule) {
          logError('Page module failed to load');
          return;
        }

        const PageComponent = pageModule.default || pageModule;
        if (!PageComponent) {
          logError('Page component not found');
          return;
        }

        const pageProps = { ...(data.props || {}), params: data.params || {} };
        let tree = React.createElement(PageComponent, pageProps);

        const layouts = data.layouts;
        if (layouts?.length) {
          for (let i = layouts.length - 1; i >= 0; i--) {
            const LayoutComponent = await loadComponent(layouts[i].path);
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

        const headings = data.headings || [];
        const pageContext = {
          slug: data.slug || '',
          path: data.pagePath || pathname,
          params: data.params || {},
          query: Object.fromEntries(new URLSearchParams(window.location.search)),
          frontmatter: data.frontmatter || {},
          headings,
          mdxHeadings: headings, // Alias for backwards compatibility
        };

        tree = React.createElement(PageContextProvider, { pageContext, children: tree });
        tree = React.createElement(RouterProvider, { router, children: tree });

        const container = document.getElementById('veryfront-content');
        if (!container) return;

        if (container.__reactRoot) {
          container.__reactRoot.render(tree);
          log('Page re-rendered');
          return;
        }

        const { hydrateRoot } = await import('react-dom/client');
        const options = {
          identifierPrefix: 'vf',
          onRecoverableError: (error) => {
            if (data.dev && typeof DEBUG !== 'undefined' && DEBUG) {
              log('Hydration mismatch (suppressed):', error.message);
            }
          },
        };

        container.__reactRoot = hydrateRoot(container, tree, options);
        log('Client-side React app hydrated successfully');

        if (window.__veryfrontHydrationComplete) {
          window.__veryfrontHydrationComplete();
        }
      } catch (error) {
        logError('Client initialization error:', error);

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
      } catch {
        // ignore parse errors
      }
    }

    // Note: popstate is handled by router.ts for SPA navigation
    // This file only handles initial page render
`;
