export const getSpaRendererScript = () => `
    async function initSpaApp() {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        logError('Hydration data not found');
        return;
      }

      let initialData = {};
      try {
        initialData = JSON.parse(dataScript.textContent || '{}');
      } catch (parseError) {
        logError('Failed to parse hydration data:', parseError);
        return;
      }

      log('Initial page data:', initialData);

      try {
        // Preload the initial page component
        const pageComponent = await loadComponent(initialData.pagePath);
        if (!pageComponent) {
          logError('Failed to load initial page component');
          return;
        }

        // Preload layout components
        for (const layout of initialData.layouts || []) {
          await loadComponent(layout.path);
        }

        // Import ClientApp dynamically
        const { ClientApp } = await import(MODULE_SERVER_URL + '/lib/spa/ClientApp.js');

        const container = document.getElementById('veryfront-content');
        if (!container) {
          logError('Content container not found');
          return;
        }

        // Create React tree with ClientApp
        // Note: QueryClientProvider should be in user's app.tsx if needed
        const tree = React.createElement(ClientApp, { initialData });

        // Hydrate or render based on whether SSR content exists
        if (container.innerHTML.trim() !== '') {
          // SSR content exists, hydrate
          const { hydrateRoot } = await import('react-dom/client');
          hydrateRoot(container, tree);
          log('Hydrated successfully');
        } else {
          // No SSR content, render fresh
          const root = createRoot(container);
          root.render(tree);
          log('Rendered successfully');
        }

        // Enable SPA mode in router
        window.__VERYFRONT_SPA_MODE__ = true;

      } catch (error) {
        logError('Initialization error:', error);
        // Fallback to legacy rendering
        renderPage(window.location.pathname);
      }
    }

    // Initialize SPA app
    initSpaApp();
`;

export const getSpaLoaderScript = () => `
    const componentCache = new Map();
    const loadingPromises = new Map();

    async function loadComponent(path) {
      if (!path) return null;

      // Check cache
      if (componentCache.has(path)) {
        return componentCache.get(path);
      }

      // Check if already loading
      if (loadingPromises.has(path)) {
        return loadingPromises.get(path);
      }

      const loadPromise = (async () => {
        try {
          const moduleUrl = pathToModuleUrl(path);
          log('Loading component:', moduleUrl);

          const module = await import(moduleUrl);
          const Component = module.default || module;

          componentCache.set(path, Component);
          loadingPromises.delete(path);

          return Component;
        } catch (error) {
          logError('Failed to load component:', path, error);
          loadingPromises.delete(path);
          return null;
        }
      })();

      loadingPromises.set(path, loadPromise);
      return loadPromise;
    }

    // Expose for ClientApp
    window.__VERYFRONT_LOAD_COMPONENT__ = loadComponent;
`;
