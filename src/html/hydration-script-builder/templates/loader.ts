import { VERSION } from "#veryfront/utils/version.ts";

export const getLoaderScript = (): string => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    const VERYFRONT_RUNTIME_VERSION = '${VERSION}';
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

    let __releaseId = null;
    function setReleaseId(value) {
      __releaseId = typeof value === 'string' && value ? value : null;
      window.__veryfrontReleaseId = __releaseId;
    }
    window.__veryfrontSetReleaseId = setReleaseId;

    function appendReleaseModuleVersion(url) {
      if (!__releaseId || url.includes('vf_release=')) return url;
      let versionedUrl = appendQueryParam(url, 'vf_release', encodeURIComponent(__releaseId));
      versionedUrl = appendQueryParam(versionedUrl, 'vf_runtime', encodeURIComponent(VERYFRONT_RUNTIME_VERSION));
      return versionedUrl;
    }

    let __releaseAssetModules = null;
    function setReleaseAssetModules(value) {
      __releaseAssetModules =
        value && typeof value === 'object' && !Array.isArray(value) ? value : null;
      window.__veryfrontReleaseAssetModules = __releaseAssetModules;
    }
    window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules;

    function normalizeReleaseAssetModulePath(path) {
      return String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '')
        .replace(/[?#].*$/, '');
    }

    function resolveReleaseAssetModuleUrl(path) {
      if (!__releaseAssetModules || __studioEmbed || __hmrRefreshTimestamp) return null;

      const key = normalizeReleaseAssetModulePath(path);
      if (__releaseAssetModules[key]) return __releaseAssetModules[key];

      const withoutExt = key.replace(/\\.(tsx|ts|jsx|mdx|js|mjs)$/, '');
      const extensions = ['.tsx', '.ts', '.jsx', '.mdx', '.js'];
      for (const ext of extensions) {
        const candidate = withoutExt + ext;
        if (__releaseAssetModules[candidate]) return __releaseAssetModules[candidate];
      }

      return null;
    }

    function pathToModuleUrl(path, studioEmbed) {
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
      if (releaseAssetUrl) return releaseAssetUrl;

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
      if (!studioEmbed && !__hmrRefreshTimestamp) url = appendReleaseModuleVersion(url);

      return url;
    }

    let __studioEmbed = false;
    function setStudioEmbed(value) {
      __studioEmbed = value;
      window.__veryfrontStudioEmbed = value;
    }
    window.__veryfrontSetStudioEmbed = setStudioEmbed;

    let __hmrRefreshTimestamp = null;
    function setHMRRefreshTimestamp(timestamp) {
      __hmrRefreshTimestamp = timestamp;
      window.__veryfrontHMRRefreshTimestamp = timestamp;
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
