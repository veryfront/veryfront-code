import { VERSION } from "#veryfront/utils/version.ts";

export const getLoaderScript = (): string => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    const VERYFRONT_RUNTIME_VERSION = '${VERSION}';
    const MAX_COMPONENT_CACHE_SIZE = 500;
    const componentCache = new Map();
    const componentCachePaths = new Map();
    const loadingPromises = new Map();
    let componentCacheGeneration = 0;

    function clearComponentCache(path) {
      // A single monotonic generation invalidates every import that began
      // before this clear without retaining one generation entry per path.
      componentCacheGeneration++;
      if (!path) {
        componentCache.clear();
        componentCachePaths.clear();
        loadingPromises.clear();
        log('Cleared all component caches');
        return;
      }

      for (const [cacheKey, cachedPath] of componentCachePaths) {
        if (cachedPath !== path) continue;
        componentCache.delete(cacheKey);
        componentCachePaths.delete(cacheKey);
        loadingPromises.delete(cacheKey);
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

    function appendReleaseModuleVersion(url, releaseId = __releaseId) {
      if (!releaseId || url.includes('vf_release=')) return url;
      let versionedUrl = appendQueryParam(url, 'vf_release', encodeURIComponent(releaseId));
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

    function readOwnReleaseAssetModuleUrl(moduleMap, path) {
      try {
        if (!Object.prototype.hasOwnProperty.call(moduleMap, path)) return null;
        const value = moduleMap[path];
        return typeof value === 'string' && value ? value : null;
      } catch {
        // Treat application-mutated browser globals as a cache miss.
        return null;
      }
    }

    function resolveReleaseAssetModuleUrl(
      path,
      moduleMap = __releaseAssetModules,
      studioEmbed = __studioEmbed,
    ) {
      if (!moduleMap || studioEmbed || __hmrRefreshTimestamp) return null;

      const key = normalizeReleaseAssetModulePath(path);
      const exactUrl = readOwnReleaseAssetModuleUrl(moduleMap, key);
      if (exactUrl) return exactUrl;

      // An explicit source extension identifies one exact module. Falling
      // through from page.tsx to a sibling page.ts silently runs different
      // source code and makes partial release manifests unsafe. Only
      // extensionless requests may probe source variants.
      if (/\\.(tsx|ts|jsx|mdx|md|js|mjs)$/.test(key)) return null;

      const extensions = ['.tsx', '.ts', '.jsx', '.mdx', '.md', '.js', '.mjs'];
      for (const ext of extensions) {
        const candidate = key + ext;
        const candidateUrl = readOwnReleaseAssetModuleUrl(moduleMap, candidate);
        if (candidateUrl) return candidateUrl;
      }

      return null;
    }

    // Select transport independently for every logical module. Release assets
    // win when that exact module is covered; remote App Router modules then use
    // the hardened RSC endpoint; all other modules retain the legacy module
    // server fallback.
    function resolveHydrationModuleUrl(
      path,
      preferRscModule,
      studioEmbed,
      moduleData,
      releaseAssetModules = moduleData?.releaseAssetModules ?? __releaseAssetModules,
      releaseId = moduleData?.releaseId ?? __releaseId,
    ) {
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(
        path,
        releaseAssetModules,
        studioEmbed,
      );
      if (releaseAssetUrl) return releaseAssetUrl;

      if (preferRscModule) {
        return appendDependencyPinningVersion(
          '/_veryfront/rsc/module?rel=' + encodeURIComponent(path),
          moduleData,
        );
      }

      return pathToModuleUrl(
        path,
        studioEmbed,
        moduleData,
        releaseAssetModules,
        releaseId,
      );
    }

    function pathToModuleUrl(
      path,
      studioEmbed,
      moduleData,
      releaseAssetModules = __releaseAssetModules,
      releaseId = __releaseId,
    ) {
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(
        path,
        releaseAssetModules,
        studioEmbed,
      );
      if (releaseAssetUrl) return releaseAssetUrl;

      const normalizedPath = normalizeReleaseAssetModulePath(path);
      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx|md|js|mjs)$/;

      const match =
        normalizedPath.match(new RegExp('/' + pattern.source)) ||
        normalizedPath.match(new RegExp('^' + pattern.source));

      const logicalPath = match
        ? match[1] + '/' + match[2] + '.' + match[3]
        : normalizedPath;
      const hasSourceExt = /\\.(tsx|ts|jsx|mdx|md|js|mjs)$/.test(logicalPath);
      // Preserve authored extensions so the module server can resolve the
      // requested source exactly. A second .js suffix disambiguates authored
      // JavaScript from the legacy extensionless compiled-module endpoint.
      const requestPath = /\\.(js|mjs)$/.test(logicalPath)
        ? logicalPath + '.js'
        : hasSourceExt
        ? logicalPath
        : logicalPath + '.js';
      let url = MODULE_SERVER_URL + '/' + requestPath;

      if (studioEmbed) url = appendQueryParam(url, 'studio_embed', 'true');
      if (__hmrRefreshTimestamp) url = appendQueryParam(url, 't', __hmrRefreshTimestamp);
      if (!studioEmbed && !__hmrRefreshTimestamp) {
        url = appendReleaseModuleVersion(url, releaseId);
      }
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

    async function loadComponentFromUrl(path, moduleUrl, options = {}) {
      if (!path || !moduleUrl) return null;

      const cacheKey = path + '\\0' + moduleUrl;
      if (componentCache.has(cacheKey)) {
        log('Component cached:', path);
        const component = componentCache.get(cacheKey);
        componentCache.delete(cacheKey);
        componentCache.set(cacheKey, component);
        return component;
      }

      const existingPromise = loadingPromises.get(cacheKey);
      if (existingPromise) return existingPromise;

      const cacheGeneration = componentCacheGeneration;
      const loadPromise = (async () => {
        try {
          const start = DEBUG ? performance.now() : 0;

          log('Loading component:', moduleUrl);
          const module = await importSnapshotBoundModule(
            moduleUrl,
            undefined,
            undefined,
            undefined,
            undefined,
            options.allowDocumentReload !== false,
          );

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

          if (cacheGeneration === componentCacheGeneration) {
            if (componentCache.size >= MAX_COMPONENT_CACHE_SIZE) {
              const oldestKey = componentCache.keys().next().value;
              if (oldestKey !== undefined) {
                componentCache.delete(oldestKey);
                componentCachePaths.delete(oldestKey);
              }
            }
            componentCache.set(cacheKey, component);
            componentCachePaths.set(cacheKey, path);
          }
          return component;
        } catch (error) {
          if (error?.dependencySnapshotConflict) throw error;
          logError('Failed to load component:', path, error);
          return null;
        } finally {
          if (loadingPromises.get(cacheKey) === loadPromise) {
            loadingPromises.delete(cacheKey);
            if (!componentCache.has(cacheKey)) componentCachePaths.delete(cacheKey);
          }
        }
      })();

      loadingPromises.set(cacheKey, loadPromise);
      componentCachePaths.set(cacheKey, path);
      return loadPromise;
    }

    async function loadComponent(path, moduleData, options = {}) {
      if (!path) return null;
      return loadComponentFromUrl(
        path,
        pathToModuleUrl(path, __studioEmbed, moduleData),
        options,
      );
    }
`;
