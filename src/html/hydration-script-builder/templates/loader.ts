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

      for (const key of componentCache.keys()) {
        if (key === path || key.startsWith(path + '|vf_pins|')) {
          componentCache.delete(key);
        }
      }
      for (const key of loadingPromises.keys()) {
        if (key === path || key.startsWith(path + '|vf_pins|')) {
          loadingPromises.delete(key);
        }
      }
      log('Cleared component cache for:', path);
    }
    window.__veryfrontClearComponentCache = clearComponentCache;

    function appendQueryParam(url, key, value) {
      return url + (url.includes('?') ? '&' : '?') + key + '=' + value;
    }

    function appendDependencyPinningVersion(url, moduleData) {
      const pinKey = moduleData && moduleData.dependencyPinningCacheKey;
      if (typeof pinKey !== 'string' || !pinKey.startsWith('on:')) return url;

      const hashIndex = url.indexOf('#');
      const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
      const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
      const queryIndex = withoutHash.indexOf('?');
      const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
      const params = new URLSearchParams(queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '');

      const modulePrefix = '/_vf_modules/';
      const prefixIndex = base.indexOf(modulePrefix);
      const origin = prefixIndex >= 0 ? base.slice(0, prefixIndex) : '';
      if (
        prefixIndex >= 0 &&
        (origin === '' || /^https?:\\/\\/[^/]+$/i.test(origin))
      ) {
        const pathStart = prefixIndex + modulePrefix.length;
        let modulePath = base.slice(pathStart);
        if (modulePath.startsWith('_pins/')) {
          const existingKeyEnd = modulePath.indexOf('/', '_pins/'.length);
          const encodedExistingKey = existingKeyEnd < 0
            ? modulePath.slice('_pins/'.length)
            : modulePath.slice('_pins/'.length, existingKeyEnd);
          let existingKey;
          try {
            existingKey = decodeURIComponent(encodedExistingKey);
          } catch {
            existingKey = undefined;
          }
          if (existingKey && /^on:[A-Za-z0-9._-]+$/.test(existingKey)) {
            if (existingKeyEnd < 0) return url;
            modulePath = modulePath.slice(existingKeyEnd + 1);
          }
        }
        params.delete('pins');
        const query = params.toString();
        return (
          base.slice(0, pathStart) +
          '_pins/' +
          encodeURIComponent(pinKey) +
          '/' +
          modulePath +
          (query ? '?' + query : '') +
          hash
        );
      }

      params.set('pins', pinKey);
      return base + '?' + params.toString() + hash;
    }

    function componentCacheKey(path, moduleData) {
      const pinKey = moduleData && moduleData.dependencyPinningCacheKey;
      return typeof pinKey === 'string' && pinKey.startsWith('on:')
        ? path + '|vf_pins|' + pinKey
        : path;
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

    function pathToModuleUrl(path, studioEmbed, moduleData) {
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
      url = appendDependencyPinningVersion(url, moduleData);

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

    async function loadComponent(path, moduleData) {
      if (!path) return null;

      const cacheKey = componentCacheKey(path, moduleData);
      if (componentCache.has(cacheKey)) {
        log('Component cached:', path);
        return componentCache.get(cacheKey);
      }

      const existingPromise = loadingPromises.get(cacheKey);
      if (existingPromise) return existingPromise;

      const loadPromise = (async () => {
        try {
          const moduleUrl = pathToModuleUrl(path, __studioEmbed, moduleData);
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

          componentCache.set(cacheKey, component);
          return component;
        } catch (error) {
          logError('Failed to load component:', path, error);
          return null;
        } finally {
          loadingPromises.delete(cacheKey);
        }
      })();

      loadingPromises.set(cacheKey, loadPromise);
      return loadPromise;
    }
`;
