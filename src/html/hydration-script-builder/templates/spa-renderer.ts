export const getSpaRendererScript = () => `
    async function initSpaApp() {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        console.error('[Veryfront SPA] Hydration data not found');
        return;
      }

      try {
        const initialData = JSON.parse(dataScript.textContent || '{}');
        console.log('[Veryfront SPA] Initial page data:', initialData);

        // Preload the initial page component
        const pageComponent = await loadComponent(initialData.pagePath);
        if (!pageComponent) {
          console.error('[Veryfront SPA] Failed to load initial page component');
          return;
        }

        // Preload layout components
        for (const layout of initialData.layouts || []) {
          await loadComponent(layout.path);
        }

        // Import ClientApp dynamically
        const { ClientApp } = await import(\`\${MODULE_SERVER_URL}/lib/spa/ClientApp.js\`);

        const container = document.getElementById('veryfront-content');
        if (!container) {
          console.error('[Veryfront SPA] Content container not found');
          return;
        }

        // Create React tree with ClientApp
        const tree = React.createElement(
          QueryClientProviderWrapper,
          null,
          React.createElement(ClientApp, { initialData })
        );

        // Hydrate or render based on whether SSR content exists
        if (container.innerHTML.trim() !== '') {
          // SSR content exists, hydrate
          const { hydrateRoot } = await import('react-dom/client');
          hydrateRoot(container, tree);
          console.log('[Veryfront SPA] Hydrated successfully');
        } else {
          // No SSR content, render fresh
          const root = createRoot(container);
          root.render(tree);
          console.log('[Veryfront SPA] Rendered successfully');
        }

        // Enable SPA mode in router
        window.__VERYFRONT_SPA_MODE__ = true;

      } catch (error) {
        console.error('[Veryfront SPA] Initialization error:', error);
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
          // Try absolute path format first (legacy): /project/dir/pages/foo.tsx
          let match = path.match(/\\/(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/);

          // Try project-relative path format: pages/foo.mdx or layouts/DefaultLayout.mdx
          if (!match) {
            match = path.match(/^(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/);
          }

          if (!match) {
            console.error('[Veryfront SPA] Invalid component path:', path);
            return null;
          }

          const relativePath = \`\${MODULE_SERVER_URL}/\${match[1]}/\${match[2]}.js\`;
          console.log('[Veryfront SPA] Loading component:', relativePath);

          const module = await import(relativePath);
          const Component = module.default || module;

          componentCache.set(path, Component);
          loadingPromises.delete(path);

          return Component;
        } catch (error) {
          console.error('[Veryfront SPA] Failed to load component:', path, error);
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
