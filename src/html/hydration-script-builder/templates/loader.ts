import { VERSION } from "#veryfront/utils/version.ts";
import { MAX_HTML_PATH_BYTES, MAX_HTML_RELEASE_ID_BYTES } from "../../limits.ts";

export const getLoaderScript = (): string => `
    // Note: DEBUG, log, logError are defined in router.ts which loads first

    const VERYFRONT_RUNTIME_VERSION = ${JSON.stringify(VERSION)};
    const MAX_MODULE_PATH_LENGTH = ${MAX_HTML_PATH_BYTES};
    const MAX_LOADER_RELEASE_ASSET_MODULES = 10000;
    let componentLoaderPromise = null;

    function getComponentLoader() {
      if (!componentLoaderPromise) {
        componentLoaderPromise = import(
          MODULE_SERVER_URL + '/_veryfront/client/spa/component-loader.js'
        ).catch((error) => {
          componentLoaderPromise = null;
          throw error;
        });
      }
      return componentLoaderPromise;
    }

    function clearComponentCache(path) {
      void path;
      getComponentLoader()
        .then((componentLoader) => componentLoader.clearComponentCache())
        .catch(() => logError('Component cache could not be cleared'));
    }
    window.__veryfrontClearComponentCache = clearComponentCache;

    function appendQueryParam(url, key, value) {
      const hashIndex = url.indexOf('#');
      const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
      const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
      const separator = base.includes('?') ? '&' : '?';
      return base + separator + encodeURIComponent(key) + '=' + encodeURIComponent(value) + hash;
    }

    let __releaseId = null;
    function setReleaseId(value) {
      __releaseId = typeof value === 'string' && value.length > 0 &&
          value.length <= ${MAX_HTML_RELEASE_ID_BYTES} &&
          new TextEncoder().encode(value).byteLength <= ${MAX_HTML_RELEASE_ID_BYTES} &&
          !hasUnsafeModulePathCharacter(value) ? value : null;
      window.__veryfrontReleaseId = __releaseId;
    }
    window.__veryfrontSetReleaseId = setReleaseId;

    function appendReleaseModuleVersion(url) {
      if (!__releaseId || /[?&]vf_release=/.test(url)) return url;
      let versionedUrl = appendQueryParam(url, 'vf_release', __releaseId);
      versionedUrl = appendQueryParam(versionedUrl, 'vf_runtime', VERYFRONT_RUNTIME_VERSION);
      return versionedUrl;
    }

    function getComponentRequestPath(path) {
      assertSafeModulePath(path);
      if (resolveReleaseAssetModuleUrl(path)) return path;
      if (__studioEmbed) return appendQueryParam(path, 'studio_embed', 'true');
      if (__hmrRefreshTimestamp) return appendQueryParam(path, 't', __hmrRefreshTimestamp);
      return appendReleaseModuleVersion(path);
    }

    let __releaseAssetModules = null;
    function snapshotReleaseAssetModules(value) {
      if (value == null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Release asset module map must be an object');
      }

      const keys = Object.keys(value);
      if (keys.length > MAX_LOADER_RELEASE_ASSET_MODULES) {
        throw new TypeError('Release asset module map exceeds the entry limit');
      }
      const snapshot = Object.create(null);
      for (const key of keys) {
        if (!key || key.startsWith('/') || normalizeReleaseAssetModulePath(key) !== key) {
          throw new TypeError('Release asset module path is invalid');
        }
        assertSafeModulePath(key);
        const assetUrl = validateReleaseAssetUrl(value[key]);
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: assetUrl,
          writable: false
        });
      }
      return Object.freeze(snapshot);
    }

    function setReleaseAssetModules(value) {
      __releaseAssetModules = snapshotReleaseAssetModules(value);
      window.__veryfrontReleaseAssetModules = __releaseAssetModules;
    }
    window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules;

    function decodePathSegment(segment) {
      let decoded = segment;
      for (let index = 0; index < MAX_MODULE_PATH_LENGTH; index++) {
        let next;
        try {
          next = decodeURIComponent(decoded);
        } catch {
          throw new TypeError('Module path contains invalid percent encoding');
        }
        if (next === decoded) return decoded;
        if (next.length >= decoded.length) {
          throw new TypeError('Module path percent decoding did not make progress');
        }
        decoded = next;
      }
      throw new TypeError('Module path contains excessive percent encoding');
    }

    function hasUnsafeModulePathCharacter(value) {
      if (value.includes('\\\\')) return true;
      for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (
          code <= 31 || (code >= 127 && code <= 159) || code === 0x200e ||
          code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
          (code >= 0x2066 && code <= 0x2069)
        ) return true;
        if (code >= 0xdc00 && code <= 0xdfff) return true;
        if (code < 0xd800 || code > 0xdbff) continue;
        const next = value.charCodeAt(index + 1);
        if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
        index++;
      }
      return false;
    }

    function assertSafeModulePath(path) {
      if (typeof path !== 'string' || !path || path.length > MAX_MODULE_PATH_LENGTH ||
          hasUnsafeModulePathCharacter(path) || /[<>"']/.test(path)) {
        throw new TypeError('Module path is invalid');
      }

      const pathname = path.replace(/[?#].*$/, '').replace(/^\\/+/, '');
      if (!pathname) throw new TypeError('Module path is invalid');

      for (const segment of pathname.split('/')) {
        const decoded = decodePathSegment(segment);
        if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') ||
            decoded.includes('?') || decoded.includes('#') || /[<>"']/.test(decoded) ||
            hasUnsafeModulePathCharacter(decoded)) {
          throw new TypeError('Module path contains an unsafe segment');
        }
      }
    }

    function normalizeReleaseAssetModulePath(path) {
      return String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '')
        .replace(/[?#].*$/, '');
    }

    function validateReleaseAssetUrl(value) {
      if (typeof value !== 'string' || !value || value.length > MAX_MODULE_PATH_LENGTH ||
          value.startsWith('//') || hasUnsafeModulePathCharacter(value)) {
        throw new TypeError('Release asset URL is invalid');
      }

      if (value.startsWith('/')) {
        assertSafeModulePath(value);
        if (value.startsWith('/_vf/assets/') &&
            !new RegExp('^/_vf/assets/[0-9a-f]{64}[.](?:js|css)(?:[?#].*)?$').test(value)) {
          throw new TypeError('Release asset URL has an invalid content hash');
        }
        return value;
      }

      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new TypeError('Release asset URL must be root-relative or absolute');
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new TypeError('Release asset URL protocol is not allowed');
      }
      assertSafeModulePath(parsed.pathname);
      return value;
    }

    function getOwnReleaseAssetUrl(key) {
      if (!Object.prototype.hasOwnProperty.call(__releaseAssetModules, key)) return null;
      return validateReleaseAssetUrl(__releaseAssetModules[key]);
    }

    function resolveReleaseAssetModuleUrl(path) {
      if (!__releaseAssetModules || __studioEmbed || __hmrRefreshTimestamp) return null;

      const key = normalizeReleaseAssetModulePath(path);
      const exact = getOwnReleaseAssetUrl(key);
      if (exact) return exact;

      const withoutExt = key.replace(/\\.(tsx|ts|jsx|mdx|md|js|mjs)$/, '');
      const extensions = ['.tsx', '.ts', '.jsx', '.mdx', '.md', '.js'];
      for (const ext of extensions) {
        const assetUrl = getOwnReleaseAssetUrl(withoutExt + ext);
        if (assetUrl) return assetUrl;
      }

      return null;
    }

    function pathToModuleUrl(path, studioEmbed) {
      assertSafeModulePath(path);
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
      if (releaseAssetUrl) return releaseAssetUrl;

      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx|md)([?#].*)?$/;
      const match =
        path.match(new RegExp('/' + pattern.source)) ||
        path.match(new RegExp('^' + pattern.source));

      let url;
      if (match) {
        url = MODULE_SERVER_URL + '/' + match[1] + '/' + match[2] + '.js' + (match[4] || '');
      } else {
        const hasKnownExt = /\\.(tsx|ts|jsx|mdx|md|js|mjs)([?#].*)?$/.test(path);
        url = MODULE_SERVER_URL + '/' +
          (hasKnownExt
            ? path.replace(/\\.(tsx|ts|jsx|mdx|md)([?#].*)?$/, '.js$2')
            : path + '.js');
      }

      if (studioEmbed) url = appendQueryParam(url, 'studio_embed', 'true');
      if (__hmrRefreshTimestamp) url = appendQueryParam(url, 't', __hmrRefreshTimestamp);
      if (!studioEmbed && !__hmrRefreshTimestamp) url = appendReleaseModuleVersion(url);

      return url;
    }

    let __studioEmbed = false;
    function setStudioEmbed(value) {
      __studioEmbed = value === true;
      window.__veryfrontStudioEmbed = __studioEmbed;
    }
    window.__veryfrontSetStudioEmbed = setStudioEmbed;

    let __hmrRefreshTimestamp = null;
    function setHMRRefreshTimestamp(timestamp) {
      __hmrRefreshTimestamp =
        typeof timestamp === 'string' && /^[0-9]{1,32}$/.test(timestamp) ? timestamp : null;
      window.__veryfrontHMRRefreshTimestamp = __hmrRefreshTimestamp;
    }
    window.__veryfrontSetHMRRefreshTimestamp = setHMRRefreshTimestamp;

    async function loadComponent(path) {
      if (!path) return null;

      try {
        assertSafeModulePath(path);
        const start = DEBUG ? performance.now() : 0;
        const componentLoader = await getComponentLoader();
        const requestPath = getComponentRequestPath(path);
        const component = await componentLoader.loadComponent(requestPath);

        if (DEBUG) {
          const duration = performance.now() - start;
          console.log('[Veryfront Perf] component import: ' + duration.toFixed(2) + 'ms');
        }
        return component;
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        logError('Component load failed (' + errorName + ')');
        return null;
      }
    }
`;
