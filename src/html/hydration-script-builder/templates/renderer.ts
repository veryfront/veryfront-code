export const getRendererScript = () => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

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
        const error = new Error('Hydration data not found');
        logError(error.message);
        if (window.__veryfrontHydrationFailed) window.__veryfrontHydrationFailed(error);
        return;
      }

      let data = {};
      try {
        const serializedData = dataScript.textContent || '{}';
        if (
          serializedData.length > MAX_PAGE_DATA_BYTES ||
          new TextEncoder().encode(serializedData).byteLength > MAX_PAGE_DATA_BYTES
        ) {
          throw new TypeError('Hydration data exceeds the size limit');
        }
        data = assertValidPageData(JSON.parse(serializedData));
      } catch (parseError) {
        logError('Failed to parse hydration data (' + getErrorName(parseError) + ')');
        if (window.__veryfrontHydrationFailed) {
          window.__veryfrontHydrationFailed(parseError);
        }
        return;
      }

      log('Hydration data loaded');

      try {
        // Set module-loading state inside the guarded initialization lifecycle.
        if (window.__veryfrontSetStudioEmbed) {
          window.__veryfrontSetStudioEmbed(data.studioEmbed === true);
        }
        if (window.__veryfrontSetReleaseId) {
          window.__veryfrontSetReleaseId(data.releaseId || null);
        }
        if (window.__veryfrontSetReleaseAssetModules) {
          window.__veryfrontSetReleaseAssetModules(data.releaseAssetModules || null);
        }

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
          assertSafeModulePath(path);
          const normalizedPath = typeof path === 'string' ? path.replace(/^\\/+/, '') : '';
          if (preferRscModule && isAppRouterPath(normalizedPath)) {
            const moduleUrl = '/_veryfront/rsc/module?rel=' + encodeURIComponent(path);
            const module = await import(moduleUrl);
            return selectComponentExport(module, path);
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

        let PageComponent = null;
        if (data.pagePath) {
          try {
            if (shouldRenderRscClientPage) {
              assertSafeModulePath(data.pagePath);
              const moduleUrl =
                '/_veryfront/rsc/module?rel=' + encodeURIComponent(data.pagePath);
              const pageModule = await import(moduleUrl);
              PageComponent = selectComponentExport(pageModule, data.pagePath);
            } else {
              PageComponent = await loadComponent(data.pagePath);
            }
          } catch (error) {
            logError('Failed to load page from hydration data (' + getErrorName(error) + ')');
            throw new Error('Page module failed to load');
          }
        }

        if (data.pagePath && !PageComponent) {
          throw new Error('Page module failed to load');
        }

        if (!data.pagePath) {
          const pageSlug = resolvedPathname === '/' ? 'index' : resolvedPathname.slice(1);
          log('Falling back to Pages Router pattern:', getSafeRoutePath(resolvedPathname));

          const candidates = ['pages/' + pageSlug];
          if (pageSlug !== 'index' && !pageSlug.endsWith('/index')) {
            candidates.push('pages/' + pageSlug + '/index');
          }
          for (const candidate of candidates) {
            PageComponent = await loadComponent(candidate);
            if (PageComponent) break;
          }
        }

        if (!PageComponent) {
          throw new Error('Page module failed to load');
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
            if (!LayoutComponent) throw new Error('Layout component failed to load');
            const WrappedLayoutComponent =
              shouldRenderRscClientPage && isRootAppLayoutPath(layouts[i].path)
                ? unwrapAppRouterDocumentLayout(LayoutComponent)
                : LayoutComponent;
            const layoutProps = data.layoutProps &&
                Object.prototype.hasOwnProperty.call(data.layoutProps, layouts[i].path)
              ? data.layoutProps[layouts[i].path]
              : {};
            tree = React.createElement(
              WrappedLayoutComponent,
              { ...layoutProps, children: tree },
            );
          }
        }

        if (data.appPath && !isolatedClientPage) {
          const AppComponent = await loadHydrationComponent(data.appPath, shouldRenderRscClientPage);
          if (!AppComponent) throw new Error('App component failed to load');
          tree = React.createElement(AppComponent, { children: tree });
        }

        const headings = Array.isArray(data.headings) ? data.headings : [];
        const pageContext = {
          slug: data.slug || '',
          path: data.pagePath || resolvedPathname,
          params: normalizedParams,
          query: { ...router.query },
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
          throw new Error('Hydration root not found');
        }

        if (container.__reactRoot) {
          container.__reactRoot.render(tree);
          log('Page re-rendered');
          window.__veryfrontHydrationComplete?.();
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
              const errorName = error instanceof Error ? error.name : 'UnknownError';
              logError('Hydration recovery failed (' + errorName + ')');
            },
          };

          container.__reactRoot = hydrateRoot(container, tree, options);
          log('Client-side React app hydrated successfully');
        }

        if (window.__veryfrontHydrationComplete) {
          window.__veryfrontHydrationComplete();
        }
      } catch (error) {
        logError('Client initialization error (' + getErrorName(error) + ')');

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
        const serializedData = initialDataScript.textContent || '{}';
        if (
          serializedData.length > MAX_PAGE_DATA_BYTES ||
          new TextEncoder().encode(serializedData).byteLength > MAX_PAGE_DATA_BYTES
        ) {
          throw new TypeError('Hydration data exceeds the size limit');
        }
        const pageData = assertValidPageData(JSON.parse(serializedData));
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
