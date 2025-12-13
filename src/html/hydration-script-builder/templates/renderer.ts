export const getRendererScript = () => `
    async function renderPage(pathname) {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        console.error('[Veryfront] Hydration data not found');
        return;
      }

      try {
        const data = JSON.parse(dataScript.textContent || '{}');

        // Try using pagePath from hydration data first (supports App Router)
        let pagePath;
        let pageModule;

        if (data.pagePath) {
          const match = data.pagePath.match(/\\/(pages|app|components|lib)\\/(.+)\\.(tsx|ts|jsx|js)$/);
          if (match) {
            pagePath = \`\${MODULE_SERVER_URL}/\${match[1]}/\${match[2]}.js\`;
            try {
              pageModule = await import(pagePath);
            } catch (error) {
              console.error('[Veryfront] Failed to load page from hydration data:', error);
            }
          }
        }

        if (!pageModule) {
          const pageSlug = pathname === '/' ? 'index' : pathname.slice(1);
          pagePath = \`\${MODULE_SERVER_URL}/pages/\${pageSlug}.js\`;
          try {
            pageModule = await import(pagePath);
          } catch (err) {
            // Try index.js fallback for directory routes
            pagePath = \`\${MODULE_SERVER_URL}/pages/\${pageSlug}/index.js\`;
            pageModule = await import(pagePath);
          }
        }

        const PageComponent = pageModule.default || pageModule;

        if (!PageComponent) {
          console.error('[Veryfront] Page component not found');
          return;
        }

        let tree = React.createElement(PageComponent, data.props || {});

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

        tree = React.createElement(RouterProvider, { children: tree });

        const container = document.getElementById('veryfront-content');
        if (container) {
          if (!container.__reactRoot) {
            container.innerHTML = '';
            const root = createRoot(container);
            root.render(tree);
            container.__reactRoot = root;
          } else {
            container.__reactRoot.render(tree);
          }
        }
      } catch (error) {
        console.error('[Veryfront] Client initialization error:', error);
      }
    }

    renderPage(window.location.pathname);

    window.addEventListener('popstate', () => {
      renderPage(window.location.pathname);
    });
`;
