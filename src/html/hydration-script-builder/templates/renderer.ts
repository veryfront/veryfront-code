export const getRendererScript = () => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    // True when a dynamic import failed because the module could not be
    // fetched (404 / network), as opposed to being fetched and then failing to
    // link or evaluate. Browsers word this as a TypeError naming the dynamic
    // import itself; link failures are SyntaxErrors and evaluation failures are
    // whatever the module threw. The wording is matched against the dynamic
    // import phrases only, so app code throwing "Failed to load user profile"
    // at module scope is not mistaken for a missing module.
    function isModuleNotFoundError(error) {
      if (!error) return false;
      if (error instanceof SyntaxError) return false;
      const message = String((error && error.message) || error);
      return /(?:dynamically imported module|Importing a module script failed|Failed to load module script)/i
        .test(message);
    }

    // Picks the error that describes the failure best. An error that proves a
    // module was reached (link or evaluation) always beats one that only proves
    // a URL could not be fetched, because a 404 on a path that was never
    // expected to exist explains nothing. Otherwise the earlier error wins: it
    // names the module the router actually intended to load.
    function preferReachedModuleError(earlier, later) {
      if (!earlier) return later;
      if (!later) return earlier;
      if (isModuleNotFoundError(earlier) && !isModuleNotFoundError(later)) return later;
      return earlier;
    }

    // Loads a Pages Router page, retrying at <route>/index.js because both
    // pages/about.tsx and pages/about/index.tsx are valid sources for the same
    // route. The retry is unconditional: gating it on the wording of the
    // first rejection turned any unrecognized wording into a blank page. Error
    // selection, not the retry, is what must stay precise.
    async function loadPageModuleWithIndexFallback(
      basePath,
      pageSlug,
      pageModuleError,
      importModule,
    ) {
      try {
        return await importModule(basePath + '.js');
      } catch (error) {
        const routeError = preferReachedModuleError(pageModuleError, error);

        // An index slug already resolves to <route>/index.js, so the retry
        // would ask for <route>/index/index.js.
        if (pageSlug === 'index' || pageSlug.endsWith('/index')) throw routeError;

        try {
          return await importModule(basePath + '/index.js');
        } catch (indexError) {
          throw preferReachedModuleError(routeError, indexError);
        }
      }
    }

    async function renderPage(pathname) {
      const resolvedPathname = (() => {
        const input = typeof pathname === 'string' ? pathname : window.location.pathname;
        try {
          return new URL(input, window.location.origin).pathname || '/';
        } catch (_) {
          /* expected: invalid URL input, fall back to string splitting */
          const [pathOnly] = String(input || '/').split(/[?#]/);
          return pathOnly || '/';
        }
      })();

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
      if (window.__veryfrontSetReleaseId) {
        window.__veryfrontSetReleaseId(data.releaseId || null);
      }
      if (data.releaseAssetModules && window.__veryfrontSetReleaseAssetModules) {
        window.__veryfrontSetReleaseAssetModules(data.releaseAssetModules);
      }

      try {
        let pageModule;
        const pagePath = typeof data.pagePath === 'string' ? data.pagePath : '';
        const normalizedPagePath = pagePath.replace(/^\\/+/, '');
        const normalizedAppRouterRoot =
          typeof data.appRouterRoot === 'string' && data.appRouterRoot.replace(/^\\/+|\\/+$/g, '')
            ? data.appRouterRoot.replace(/^\\/+|\\/+$/g, '')
            : 'app';

        function isAppRouterPath(path) {
          const normalizedPath = typeof path === 'string' ? path.replace(/^\\/+/, '') : '';
          return normalizedPath === normalizedAppRouterRoot ||
            normalizedPath.startsWith(normalizedAppRouterRoot + '/');
        }

        function isRootAppLayoutPath(path) {
          const normalizedPath = typeof path === 'string' ? path.replace(/^\\/+/, '') : '';
          const pathWithoutExtension = normalizedPath.replace(/\\.(?:tsx|jsx|ts|js)$/, '');
          return pathWithoutExtension === normalizedAppRouterRoot + '/layout';
        }

        const shouldRenderRscClientPage =
          data.clientModuleStrategy === 'rsc-module' && isAppRouterPath(normalizedPagePath);
        const isolatedClientPage =
          shouldRenderRscClientPage && data.isolatedClientPage === true;

        async function loadHydrationComponent(path, preferRscModule) {
          const normalizedPath = typeof path === 'string' ? path.replace(/^\\/+/, '') : '';
          if (preferRscModule && isAppRouterPath(normalizedPath)) {
            const moduleUrl = '/_veryfront/rsc/module?rel=' + encodeURIComponent(path);
            log('Loading App Router component from RSC module:', moduleUrl);
            const module = await import(moduleUrl);
            return module.default || module;
          }

          return loadComponent(path);
        }

        function unwrapAppRouterDocumentLayout(LayoutComponent) {
          return function AppRouterDocumentLayout(props) {
            const element = LayoutComponent(props);
            if (!React.isValidElement(element) || element.type !== 'html') {
              return element;
            }

            const body = React.Children.toArray(element.props?.children).find((child) =>
              React.isValidElement(child) && child.type === 'body'
            );
            return body?.props?.children ?? props.children;
          };
        }

        let pageModuleError = null;

        if (data.pagePath) {
          const moduleUrl = shouldRenderRscClientPage
            ? '/_veryfront/rsc/module?rel=' + encodeURIComponent(data.pagePath)
            : pathToModuleUrl(data.pagePath, data.studioEmbed);
          log('Loading page from hydration data:', moduleUrl);

          try {
            pageModule = await import(moduleUrl);
          } catch (error) {
            pageModuleError = error;
            logError('Failed to load page from hydration data:', error);
          }
        }

        if (!pageModule) {
          const pageSlug = resolvedPathname === '/' ? 'index' : resolvedPathname.slice(1);
          log('Falling back to Pages Router pattern:', pageSlug);

          const prefix = pageSlug.startsWith('@/') ? '' : '/pages';
          const basePath = MODULE_SERVER_URL + prefix + '/' + pageSlug;

          pageModule = await loadPageModuleWithIndexFallback(
            basePath,
            pageSlug,
            pageModuleError,
            (moduleUrl) => import(moduleUrl),
          );
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

        // Normalize catch-all params (arrays -> joined strings) so the hydrated
        // props and page context match the server render. normalizeRouteParams
        // is defined in router.ts, which loads first (issue #2742).
        const normalizedParams = normalizeRouteParams(data.params);
        const pageProps = { ...(data.props || {}), params: normalizedParams };
        let tree = React.createElement(PageComponent, pageProps);

        const layouts = data.layouts;
        if (layouts?.length) {
          for (let i = layouts.length - 1; i >= 0; i--) {
            const LayoutComponent = await loadHydrationComponent(
              layouts[i].path,
              shouldRenderRscClientPage,
            );
            if (LayoutComponent) {
              const WrappedLayoutComponent =
                shouldRenderRscClientPage && isRootAppLayoutPath(layouts[i].path)
                  ? unwrapAppRouterDocumentLayout(LayoutComponent)
                  : LayoutComponent;
              const layoutProps = data.layoutProps?.[layouts[i].path] || {};
              tree = React.createElement(
                WrappedLayoutComponent,
                { ...layoutProps, children: tree },
              );
            }
          }
        }

        if (data.appPath && !isolatedClientPage) {
          const AppComponent = await loadHydrationComponent(data.appPath, shouldRenderRscClientPage);
          if (AppComponent) {
            tree = React.createElement(AppComponent, { children: tree });
          }
        }

        const headings = data.headings || [];
        const pageContext = {
          slug: data.slug || '',
          path: data.pagePath || resolvedPathname,
          params: normalizedParams,
          query: Object.fromEntries(new URLSearchParams(window.location.search)),
          frontmatter: data.frontmatter || {},
          headings,
          mdxHeadings: headings, // Alias for backwards compatibility
        };

        tree = React.createElement(PageContextProvider, { pageContext, children: tree });
        tree = React.createElement(RouterProvider, { router, children: tree });

        const container = isolatedClientPage
          ? document.getElementById('veryfront-page-island')
          : document.getElementById('root');
        if (!container) {
          if (isolatedClientPage) {
            throw new Error('Isolated client page root not found');
          }
          return;
        }

        if (container.__reactRoot) {
          container.__reactRoot.render(tree);
          log('Page re-rendered');
          return;
        }

        if (shouldRenderRscClientPage) {
          container.__reactRoot = createRoot(container);
          container.__reactRoot.render(tree);
          log('Client-side React app rendered successfully');
        } else {
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
        }

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
      } catch (_) {
        /* expected: hydration data JSON parse errors are non-critical */
      }
    }

    // Note: popstate is handled by router.ts for SPA navigation
    // This file only handles initial page render
`;
