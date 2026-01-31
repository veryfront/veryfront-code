export const getSpaRendererScript = (): string => `
    async function initSpaApp() {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        logError('Hydration data not found');
        return;
      }

      let initialData = {};
      try {
        initialData = JSON.parse(dataScript.textContent ?? '{}');
      } catch (parseError) {
        logError('Failed to parse hydration data:', parseError);
        return;
      }

      log('Initial page data:', initialData);

      if (initialData.studioEmbed && window.__veryfrontSetStudioEmbed) {
        window.__veryfrontSetStudioEmbed(true);
      }

      try {
        const pageComponent = await loadComponent(initialData.pagePath);
        if (!pageComponent) {
          logError('Failed to load initial page component');
          return;
        }

        for (const layout of initialData.layouts ?? []) {
          await loadComponent(layout.path);
        }

        const { ClientApp } = await import(MODULE_SERVER_URL + '/lib/spa/ClientApp.js');

        const container = document.getElementById('veryfront-content');
        if (!container) {
          logError('Content container not found');
          return;
        }

        const tree = React.createElement(ClientApp, { initialData });

        if (container.innerHTML.trim()) {
          const { hydrateRoot } = await import('react-dom/client');
          hydrateRoot(container, tree, {
            identifierPrefix: 'vf',
            onRecoverableError: () => {}
          });
          log('Hydrated successfully');
        } else {
          const root = createRoot(container);
          root.render(tree);
          log('Rendered successfully');
        }

        window.__VERYFRONT_SPA_MODE__ = true;
      } catch (error) {
        logError('Initialization error:', error);
        renderPage(window.location.pathname);
      }
    }

    initSpaApp();
`;

export const getSpaLoaderScript = (): string => `
    const componentCache = new Map();
    const loadingPromises = new Map();

    async function loadComponent(path) {
      if (!path) return null;

      const cached = componentCache.get(path);
      if (cached) return cached;

      const existingPromise = loadingPromises.get(path);
      if (existingPromise) return existingPromise;

      const loadPromise = (async () => {
        try {
          const moduleUrl = pathToModuleUrl(path);
          log('Loading component:', moduleUrl);

          const module = await import(moduleUrl);
          const Component = module.default || module;

          componentCache.set(path, Component);
          return Component;
        } catch (error) {
          logError('Failed to load component:', path, error);
          return null;
        } finally {
          loadingPromises.delete(path);
        }
      })();

      loadingPromises.set(path, loadPromise);
      return loadPromise;
    }

    window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
`;
