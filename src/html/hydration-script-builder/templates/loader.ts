export const getLoaderScript = () => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    // Component cache to avoid re-importing
    const componentCache = new Map();
    const loadingPromises = new Map();

    function pathToModuleUrl(path) {
      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/;

      // Try absolute path format (legacy): /project/dir/pages/foo.tsx
      let match = path.match(new RegExp('/' + pattern.source));

      // Try project-relative path format: pages/foo.mdx
      if (!match) {
        match = path.match(new RegExp('^' + pattern.source));
      }

      if (!match) {
        // Direct path fallback - replace extension or add .js if no known extension
        const hasKnownExt = /\\.(tsx|ts|jsx|mdx|js|mjs)$/.test(path);
        if (hasKnownExt) {
          return MODULE_SERVER_URL + '/' + path.replace(/\\.(tsx|ts|jsx|mdx)$/, '.js');
        }
        // No extension - add .js (e.g., _snippets/abc123 -> _snippets/abc123.js)
        return MODULE_SERVER_URL + '/' + path + '.js';
      }

      return MODULE_SERVER_URL + '/' + match[1] + '/' + match[2] + '.js';
    }

    async function loadComponent(path) {
      if (!path) return null;

      // Check cache first
      if (componentCache.has(path)) {
        log('Component cached:', path);
        return componentCache.get(path);
      }

      // Deduplicate concurrent loads
      if (loadingPromises.has(path)) {
        return loadingPromises.get(path);
      }

      const loadPromise = (async () => {
        try {
          const moduleUrl = pathToModuleUrl(path);
          const start = DEBUG ? performance.now() : 0;
          log('Loading component:', moduleUrl);
          const module = await import(moduleUrl);
          const component = module.default || module;
          if (DEBUG) {
            const duration = performance.now() - start;
            console.log('[Veryfront Perf] %cimport:' + path.split('/').pop() + ': %c' + duration.toFixed(2) + 'ms',
              'color: #888', duration > 50 ? 'color: #f00; font-weight: bold' : 'color: #0a0');
          }
          componentCache.set(path, component);
          loadingPromises.delete(path);
          return component;
        } catch (error) {
          logError('Failed to load component:', path, error);
          loadingPromises.delete(path);
          return null;
        }
      })();

      loadingPromises.set(path, loadPromise);
      return loadPromise;
    }
`;
