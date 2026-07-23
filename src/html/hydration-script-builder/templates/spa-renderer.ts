import { MAX_HTML_HYDRATION_DATA_BYTES, MAX_HTML_NESTED_LAYOUTS } from "../../limits.ts";

export const getSpaRendererScript = (): string => `
    async function initSpaApp() {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        const error = new Error('Hydration data not found');
        logError(error.message);
        window.__veryfrontHydrationFailed?.(error);
        return;
      }

      let initialData = {};
      try {
        const serializedData = dataScript.textContent ?? '{}';
        if (
          serializedData.length > ${MAX_HTML_HYDRATION_DATA_BYTES} ||
          new TextEncoder().encode(serializedData).byteLength > ${MAX_HTML_HYDRATION_DATA_BYTES}
        ) {
          throw new TypeError('Hydration data exceeds the size limit');
        }
        initialData = assertValidPageData(JSON.parse(serializedData));
      } catch (parseError) {
        const errorName = parseError instanceof Error ? parseError.name : 'UnknownError';
        logError('Failed to parse hydration data (' + errorName + ')');
        window.__veryfrontHydrationFailed?.(parseError);
        return;
      }

      log('Initial page data loaded');

      try {
        window.__veryfrontSetStudioEmbed?.(initialData.studioEmbed === true);
        window.__veryfrontSetReleaseAssetModules?.(initialData.releaseAssetModules || null);
        window.__veryfrontSetReleaseId?.(initialData.releaseId || null);

        const pageComponent = await loadComponent(initialData.pagePath);
        if (!pageComponent) {
          throw new Error('Initial page component failed to load');
        }

        const layouts = Array.isArray(initialData.layouts) ? initialData.layouts : [];
        if (layouts.length > ${MAX_HTML_NESTED_LAYOUTS}) {
          throw new TypeError('Hydration data contains too many layouts');
        }
        for (const layout of layouts) {
          if (!await loadComponent(layout.path)) {
            throw new Error('Initial layout component failed to load');
          }
        }
        if (initialData.appPath) {
          if (!await loadComponent(initialData.appPath)) {
            throw new Error('Initial app component failed to load');
          }
        }

        const { ClientApp } = await import(MODULE_SERVER_URL + '/_veryfront/client/spa/ClientApp.js');

        const container = document.getElementById('root');
        if (!container) {
          throw new Error('Content container not found');
        }

        const tree = React.createElement(ClientApp, { initialData });

        if (container.innerHTML.trim()) {
          const { hydrateRoot } = await import('react-dom/client');
          container.__reactRoot = hydrateRoot(container, tree, {
            identifierPrefix: 'vf',
            onRecoverableError: (error) => {
              const errorName = error instanceof Error ? error.name : 'UnknownError';
              logError('Hydration recovery failed (' + errorName + ')');
            }
          });
          log('Hydrated successfully');
        } else {
          container.__reactRoot = createRoot(container);
          container.__reactRoot.render(tree);
          log('Rendered successfully');
        }

        window.__VERYFRONT_SPA_MODE__ = true;
        if (window.__veryfrontHydrationComplete) window.__veryfrontHydrationComplete();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        logError('Initialization failed (' + errorName + ')');
        renderPage(window.location.pathname);
      }
    }

    initSpaApp();
`;

export const getSpaLoaderScript = (): string => `
    let componentLoaderPromise;

    function getComponentLoader() {
      componentLoaderPromise ??= import(
        MODULE_SERVER_URL + '/_veryfront/client/spa/component-loader.js'
      ).catch((error) => {
        componentLoaderPromise = null;
        throw error;
      });
      return componentLoaderPromise;
    }

    async function loadComponent(path) {
      if (!path) return null;
      try {
        const loader = await getComponentLoader();
        return await loader.loadComponent(path);
      } catch {
        logError('Component loader is unavailable');
        return null;
      }
    }

    window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
`;
