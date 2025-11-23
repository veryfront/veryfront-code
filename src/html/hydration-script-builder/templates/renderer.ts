export const getRendererScript = () => `
    async function renderPage(pathname) {
      const dataScript = document.getElementById('veryfront-hydration-data');
      if (!dataScript) {
        console.error('[Veryfront] Hydration data not found');
        return;
      }

      try {
        const data = JSON.parse(dataScript.textContent || '{}');

        console.log('[Veryfront] Hydration data:', data);

        // Try using pagePath from hydration data first (supports App Router)
        let pagePath;
        let pageModule;

        if (data.pagePath) {
          // Use the server-provided page path
          // Convert: /project/app/page.tsx -> /app/page.js
          // Convert: /project/pages/index.tsx -> /pages/index.js
          const match = data.pagePath.match(/\/(pages|app|components|lib)\\/(.+)\.(tsx|ts|jsx|js)$/);
          if (match) {
            pagePath = \`\${MODULE_SERVER_URL}/\${match[1]}/\${match[2]}.js\`;
            console.log('[Veryfront] Loading page from hydration data:', pagePath);
            try {
              pageModule = await import(pagePath);
            } catch (error) {
              console.error('[Veryfront] Failed to load page from hydration data:', error);
            }
          }
        }

        // Fallback to old Pages Router behavior if pagePath not available
        if (!pageModule) {
          const pageSlug = pathname === '/' ? 'index' : pathname.slice(1);
          console.log('[Veryfront] Falling back to Pages Router pattern:', pageSlug);
          console.log('[DEBUG] MODULE_SERVER_URL before import:', MODULE_SERVER_URL);
          pagePath = \`\${MODULE_SERVER_URL}/pages/\${pageSlug}.js\`;
          console.log('[DEBUG] Constructed pagePath:', pagePath);
          try {
            pageModule = await import(pagePath);
          } catch (err) {
            pagePath = \`\${MODULE_SERVER_URL}/pages/\${pageSlug}/index.js\`;
            console.log('[DEBUG] Fallback pagePath:', pagePath);
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
            console.log('[Veryfront] Client-side React app mounted successfully');
          } else {
            container.__reactRoot.render(tree);
            console.log('[Veryfront] Page re-rendered');
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
