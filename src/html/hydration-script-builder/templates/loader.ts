export const getLoaderScript = (): string => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    const componentCache = new Map();
    const loadingPromises = new Map();

    function clearComponentCache(path) {
      if (!path) {
        componentCache.clear();
        loadingPromises.clear();
        log('Cleared all component caches');
        return;
      }

      componentCache.delete(path);
      loadingPromises.delete(path);
      log('Cleared component cache for:', path);
    }
    window.__veryfrontClearComponentCache = clearComponentCache;

    function appendQueryParam(url, key, value) {
      return url + (url.includes('?') ? '&' : '?') + key + '=' + value;
    }

    function pathToModuleUrl(path, studioEmbed) {
      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)$/;

      const match =
        path.match(new RegExp('/' + pattern.source)) ||
        path.match(new RegExp('^' + pattern.source));

      let url;
      if (match) {
        url = MODULE_SERVER_URL + '/' + match[1] + '/' + match[2] + '.js';
      } else {
        const hasKnownExt = /\\.(tsx|ts|jsx|mdx|js|mjs)$/.test(path);
        url =
          MODULE_SERVER_URL +
          '/' +
          (hasKnownExt ? path.replace(/\\.(tsx|ts|jsx|mdx)$/, '.js') : path + '.js');
      }

      if (studioEmbed) url = appendQueryParam(url, 'studio_embed', 'true');
      if (__hmrRefreshTimestamp) url = appendQueryParam(url, 't', __hmrRefreshTimestamp);

      return url;
    }

    let __studioEmbed = false;
    function setStudioEmbed(value) {
      __studioEmbed = value;
    }
    window.__veryfrontSetStudioEmbed = setStudioEmbed;

    let __hmrRefreshTimestamp = null;
    function setHMRRefreshTimestamp(timestamp) {
      __hmrRefreshTimestamp = timestamp;
    }
    window.__veryfrontSetHMRRefreshTimestamp = setHMRRefreshTimestamp;

    async function loadComponent(path) {
      if (!path) return null;

      if (componentCache.has(path)) {
        log('Component cached:', path);
        return componentCache.get(path);
      }

      const existingPromise = loadingPromises.get(path);
      if (existingPromise) return existingPromise;

      const loadPromise = (async () => {
        try {
          const moduleUrl = pathToModuleUrl(path, __studioEmbed);
          const start = DEBUG ? performance.now() : 0;

          log('Loading component:', moduleUrl);
          const module = await import(moduleUrl);

          // Prefer MDXLayout/MainLayout over default for MDX files
          // MDXContent (default export) has a bug where it overwrites children prop
          // SSR uses mod.MDXLayout || mod.MainLayout || mod.default - match that behavior
          const component = module.MDXLayout || module.MainLayout || module.default || module;

          if (DEBUG) {
            const duration = performance.now() - start;
            console.log(
              '[Veryfront Perf] %cimport:' + path.split('/').pop() + ': %c' + duration.toFixed(2) + 'ms',
              'color: #888',
              duration > 50 ? 'color: #f00; font-weight: bold' : 'color: #0a0'
            );
          }

          componentCache.set(path, component);
          return component;
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
`;
