/**
 * Shared path utilities for SPA module resolution.
 * Used by component-loader.ts and hydration script templates.
 */

import { VERSION } from "#veryfront/utils/version-constant.ts";

/** Supported source directories for module resolution */
const SOURCE_DIRS = ["pages", "components", "app", "lib", "layouts", "shared", "features"] as const;

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ["tsx", "ts", "jsx", "mdx", "md"] as const;

/** Regex pattern for matching source paths */
const SOURCE_PATH_PATTERN = new RegExp(
  `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})([?#].*)?$`,
);

const MODULE_SERVER_PATH_PATTERN = /^\/?_vf_modules\//;
const KNOWN_EXT_PATTERN = /\.(tsx|ts|jsx|mdx|md|js|mjs)([?#].*)?$/;
const SOURCE_EXT_REPLACE_PATTERN = /\.(tsx|ts|jsx|mdx|md)([?#].*)?$/;
const ABSOLUTE_URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;
const MAX_MODULE_PATH_LENGTH = 4_096;
const MAX_RELEASE_ASSET_MODULES = 10_000;
const MAX_RELEASE_ID_LENGTH = 256;
const FORBIDDEN_MODULE_PATH_PATTERN = /[<>"']/;
const textEncoder = new TextEncoder();
const releaseAssetSnapshotCache = new WeakMap<object, Readonly<Record<string, string>>>();

/** Precomputed regex for absolute paths containing a source directory */
const ABSOLUTE_SOURCE_PATH_PATTERN = new RegExp(`/${SOURCE_PATH_PATTERN.source}`);

/** Precomputed regex for relative paths starting with a source directory */
const RELATIVE_SOURCE_PATH_PATTERN = new RegExp(`^${SOURCE_PATH_PATTERN.source}`);

function getOwnGlobalDataProperty(key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  } catch {
    throw new TypeError("Browser module configuration cannot be inspected");
  }
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set || !("value" in descriptor)) {
    throw new TypeError("Browser module configuration cannot be inspected");
  }
  return descriptor.value;
}

interface ModuleRuntimeContext {
  studioEmbed: boolean;
  hmrRefreshTimestamp: string | null;
  releaseId: string | null;
}

function decodePathSegment(segment: string): string {
  let decoded = segment;
  for (let index = 0; index < MAX_MODULE_PATH_LENGTH; index++) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new TypeError("Module path contains invalid percent encoding");
    }
    if (next === decoded) return decoded;
    if (next.length >= decoded.length) {
      throw new TypeError("Module path percent decoding did not make progress");
    }
    decoded = next;
  }
  throw new TypeError("Module path contains excessive percent encoding");
}

function hasUnsafeModulePathCharacter(value: string): boolean {
  if (value.includes("\\")) return true;
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

function exceedsModulePathLimit(value: string): boolean {
  return value.length > MAX_MODULE_PATH_LENGTH ||
    textEncoder.encode(value).byteLength > MAX_MODULE_PATH_LENGTH;
}

function getModuleRuntimeContext(
  releaseIdOverride?: string | null,
): ModuleRuntimeContext {
  const studioEmbed = getOwnGlobalDataProperty("__veryfrontStudioEmbed") === true;
  const hmrValue = getOwnGlobalDataProperty("__veryfrontHMRRefreshTimestamp");
  const releaseValue = releaseIdOverride === undefined
    ? getOwnGlobalDataProperty("__veryfrontReleaseId")
    : releaseIdOverride;
  const hmrRefreshTimestamp = typeof hmrValue === "string" && /^[0-9]{1,32}$/.test(hmrValue)
    ? hmrValue
    : null;
  const releaseId = typeof releaseValue === "string" && releaseValue.length > 0 &&
      releaseValue.length <= MAX_RELEASE_ID_LENGTH &&
      textEncoder.encode(releaseValue).byteLength <= MAX_RELEASE_ID_LENGTH &&
      !hasUnsafeModulePathCharacter(releaseValue)
    ? releaseValue
    : null;
  if (releaseIdOverride !== undefined && releaseValue !== null && releaseId === null) {
    throw new TypeError("Release id is invalid");
  }
  return { studioEmbed, hmrRefreshTimestamp, releaseId };
}

function hasQueryParameter(url: string, name: string): boolean {
  const queryStart = url.indexOf("?");
  const hashStart = url.indexOf("#");
  if (queryStart < 0 || (hashStart >= 0 && queryStart > hashStart)) return false;
  const query = url.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
  return query.split("&").some((part) => part.split("=", 1)[0] === name);
}

function appendQueryParameter(url: string, name: string, value: string): string {
  const hashIndex = url.indexOf("#");
  const hash = hashIndex < 0 ? "" : url.slice(hashIndex);
  const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}${encodeURIComponent(name)}=${encodeURIComponent(value)}${hash}`;
}

function applyRuntimeContext(url: string, context: ModuleRuntimeContext): string {
  if (context.studioEmbed) {
    return hasQueryParameter(url, "studio_embed")
      ? url
      : appendQueryParameter(url, "studio_embed", "true");
  }
  if (context.hmrRefreshTimestamp) {
    return hasQueryParameter(url, "t")
      ? url
      : appendQueryParameter(url, "t", context.hmrRefreshTimestamp);
  }
  if (!context.releaseId || hasQueryParameter(url, "vf_release")) return url;
  const versioned = appendQueryParameter(url, "vf_release", context.releaseId);
  return hasQueryParameter(versioned, "vf_runtime")
    ? versioned
    : appendQueryParameter(versioned, "vf_runtime", VERSION);
}

export function assertSafeModulePath(path: string): void {
  if (
    typeof path !== "string" || !path || exceedsModulePathLimit(path) ||
    hasUnsafeModulePathCharacter(path) || FORBIDDEN_MODULE_PATH_PATTERN.test(path)
  ) {
    throw new TypeError("Module path is invalid");
  }

  const pathname = path.replace(/[?#].*$/, "").replace(/^\/+/, "");
  if (!pathname) throw new TypeError("Module path is invalid");

  for (const segment of pathname.split("/")) {
    const decoded = decodePathSegment(segment);
    if (
      !decoded || decoded === "." || decoded === ".." || decoded.includes("/") ||
      decoded.includes("?") || decoded.includes("#") ||
      hasUnsafeModulePathCharacter(decoded) || FORBIDDEN_MODULE_PATH_PATTERN.test(decoded)
    ) {
      throw new TypeError("Module path contains an unsafe segment");
    }
  }
}

function normalizeModuleBaseUrl(baseUrl: string): string {
  if (
    typeof baseUrl !== "string" || !baseUrl || exceedsModulePathLimit(baseUrl) ||
    /[?#]/.test(baseUrl) || hasUnsafeModulePathCharacter(baseUrl) ||
    FORBIDDEN_MODULE_PATH_PATTERN.test(baseUrl)
  ) {
    throw new TypeError("Module server URL is invalid");
  }
  if (baseUrl.startsWith("//")) {
    throw new TypeError("Module server URL must not be protocol-relative");
  }

  if (ABSOLUTE_URL_SCHEME_PATTERN.test(baseUrl)) {
    const parsed = new URL(baseUrl);
    if (
      !["file:", "http:", "https:"].includes(parsed.protocol) || parsed.username ||
      parsed.password
    ) {
      throw new TypeError("Module server URL protocol is not allowed");
    }
    const absolutePrefix = baseUrl.match(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//)?.[0];
    if (!absolutePrefix) throw new TypeError("Module server URL must be absolute");
    const rawPathStart = baseUrl.indexOf("/", absolutePrefix.length);
    const rawPath = rawPathStart < 0 ? "" : baseUrl.slice(rawPathStart).replace(/\/+$/, "");
    if (rawPath) assertSafeModulePath(rawPath);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") assertSafeModulePath(pathname);
  } else if (baseUrl !== "/") {
    assertSafeModulePath(baseUrl.replace(/\/+$/, ""));
  }

  if (baseUrl === "/") return "";
  return baseUrl.replace(/\/+$/, "");
}

function joinModuleUrl(baseUrl: string, modulePath: string): string {
  return `${normalizeModuleBaseUrl(baseUrl)}/${modulePath}`;
}

function validateReleaseAssetUrl(value: unknown): string {
  if (
    typeof value !== "string" || !value || exceedsModulePathLimit(value) ||
    hasUnsafeModulePathCharacter(value) || FORBIDDEN_MODULE_PATH_PATTERN.test(value)
  ) {
    throw new TypeError("Release asset URL is invalid");
  }
  if (value.startsWith("//")) {
    throw new TypeError("Release asset URL is invalid");
  }
  if (value.startsWith("/")) {
    assertSafeModulePath(value);
    if (
      value.startsWith("/_vf/assets/") &&
      !/^\/_vf\/assets\/[0-9a-f]{64}\.(?:js|css)(?:[?#].*)?$/.test(value)
    ) {
      throw new TypeError("Release asset URL has an invalid content hash");
    }
    return value;
  }

  const absolutePrefix = value.match(/^https?:\/\//i)?.[0];
  if (!absolutePrefix) throw new TypeError("Release asset URL protocol is not allowed");
  const rawPathStart = value.indexOf("/", absolutePrefix.length);
  if (rawPathStart < 0) throw new TypeError("Release asset URL must include a path");
  assertSafeModulePath(value.slice(rawPathStart));

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("Release asset URL must be root-relative or absolute");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError("Release asset URL protocol is not allowed");
  }
  assertSafeModulePath(parsed.pathname);
  return value;
}

export function snapshotReleaseAssetModules(
  value: Record<string, string>,
): Readonly<Record<string, string>> {
  const cached = releaseAssetSnapshotCache.get(value);
  if (cached) return cached;

  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw new TypeError("Release asset module map cannot be inspected");
  }
  if (keys.length > MAX_RELEASE_ASSET_MODULES) {
    throw new TypeError("Release asset module map exceeds the entry limit");
  }

  const snapshot = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      throw new TypeError("Release asset module map cannot be inspected");
    }
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string" || descriptor.get || descriptor.set || !("value" in descriptor)) {
      throw new TypeError("Release asset module map cannot be inspected");
    }
    if (!key || key.startsWith("/") || normalizeReleaseAssetModulePath(key) !== key) {
      throw new TypeError("Release asset module path is invalid");
    }
    assertSafeModulePath(key);
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: validateReleaseAssetUrl(descriptor.value),
      writable: false,
    });
  }
  Object.freeze(snapshot);
  releaseAssetSnapshotCache.set(value, snapshot);
  return snapshot;
}

function getOwnReleaseAssetUrl(
  releaseAssetModules: Readonly<Record<string, string>>,
  key: string,
): string | null {
  if (!Object.prototype.hasOwnProperty.call(releaseAssetModules, key)) return null;
  return releaseAssetModules[key] ?? null;
}

function normalizeReleaseAssetModulePath(path: string): string {
  return String(path || "")
    .replace(/^\/?_vf_modules\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "");
}

function resolveReleaseAssetModuleUrl(
  path: string,
  context: ModuleRuntimeContext,
  releaseAssetModulesOverride?: Record<string, string> | null,
): string | null {
  const releaseAssetModules = releaseAssetModulesOverride === undefined
    ? getOwnGlobalDataProperty("__veryfrontReleaseAssetModules") as
      | Record<string, string>
      | null
      | undefined
    : releaseAssetModulesOverride;
  if (!releaseAssetModules || context.studioEmbed || context.hmrRefreshTimestamp) {
    return null;
  }

  const snapshot = snapshotReleaseAssetModules(releaseAssetModules);

  const key = normalizeReleaseAssetModulePath(path);
  const exact = getOwnReleaseAssetUrl(snapshot, key);
  if (exact) return exact;

  const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|md|js|mjs)$/, "");
  for (const ext of [".tsx", ".ts", ".jsx", ".mdx", ".md", ".js"]) {
    const candidate = withoutExt + ext;
    const assetUrl = getOwnReleaseAssetUrl(snapshot, candidate);
    if (assetUrl) return assetUrl;
  }

  return null;
}

function normalizeModuleRequestPath(path: string): string {
  const key = String(path || "")
    .replace(MODULE_SERVER_PATH_PATTERN, "")
    .replace(/^\/+/, "");

  if (SOURCE_EXT_REPLACE_PATTERN.test(key)) {
    return key.replace(SOURCE_EXT_REPLACE_PATTERN, ".js$2");
  }

  if (KNOWN_EXT_PATTERN.test(key)) {
    return key;
  }

  return `${key}.js`;
}

/** Return the configured browser module-server URL. */
export function getModuleServerUrl(): string {
  if (typeof window === "undefined") return "/_vf_modules";
  const configured = getOwnGlobalDataProperty("MODULE_SERVER_URL");
  if (configured === undefined) return "/_vf_modules";
  if (typeof configured !== "string") throw new TypeError("Module server URL must be a string");
  return configured;
}

/** Resolve a source path to a safe browser-importable module URL. */
export function pathToModuleUrl(
  path: string,
  baseUrl?: string,
  releaseAssetModules?: Record<string, string> | null,
  releaseId?: string | null,
): string {
  assertSafeModulePath(path);
  const runtimeContext = getModuleRuntimeContext(releaseId);
  const releaseAssetUrl = resolveReleaseAssetModuleUrl(path, runtimeContext, releaseAssetModules);
  if (releaseAssetUrl) return releaseAssetUrl;

  const base = baseUrl ?? getModuleServerUrl();
  let moduleUrl: string;

  if (MODULE_SERVER_PATH_PATTERN.test(path)) {
    moduleUrl = joinModuleUrl(base, normalizeModuleRequestPath(path));
  } else {
    const match = path.match(ABSOLUTE_SOURCE_PATH_PATTERN) ??
      path.match(RELATIVE_SOURCE_PATH_PATTERN);
    moduleUrl = match
      ? joinModuleUrl(base, `${match[1]}/${match[2]}.js${match[4] ?? ""}`)
      : joinModuleUrl(base, normalizeModuleRequestPath(path));
  }
  return applyRuntimeContext(moduleUrl, runtimeContext);
}

/** Return the standalone browser helper used by hydration templates. */
export function getPathToModuleUrlScript(): string {
  return `
    var __veryfrontClientMaxModulePathLength = ${MAX_MODULE_PATH_LENGTH};
    var __veryfrontClientMaxReleaseAssetModules = ${MAX_RELEASE_ASSET_MODULES};
    var __veryfrontClientMaxReleaseIdLength = ${MAX_RELEASE_ID_LENGTH};
    var __veryfrontClientRuntimeVersion = ${JSON.stringify(VERSION)};
    var __veryfrontClientReleaseAssetModules = null;

    function getOwnWindowDataProperty(key) {
      let descriptor;
      try {
        descriptor = Object.getOwnPropertyDescriptor(window, key);
      } catch {
        throw new TypeError('Browser module configuration cannot be inspected');
      }
      if (!descriptor) return undefined;
      if (descriptor.get || descriptor.set ||
          !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError('Browser module configuration cannot be inspected');
      }
      return descriptor.value;
    }

    function normalizeReleaseAssetModulePath(path) {
      return String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '')
        .replace(/[?#].*$/, '');
    }

    function decodePathSegment(segment) {
      let decoded = segment;
      for (let index = 0; index < __veryfrontClientMaxModulePathLength; index++) {
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
        if (code <= 31 || (code >= 127 && code <= 159) || code === 0x200e ||
            code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
            (code >= 0x2066 && code <= 0x2069)) return true;
        if (code >= 0xdc00 && code <= 0xdfff) return true;
        if (code < 0xd800 || code > 0xdbff) continue;
        const next = value.charCodeAt(index + 1);
        if (!Number.isFinite(next) || next < 0xdc00 || next > 0xdfff) return true;
        index++;
      }
      return false;
    }

    function exceedsModulePathLimit(value) {
      return value.length > __veryfrontClientMaxModulePathLength ||
        new TextEncoder().encode(value).byteLength > __veryfrontClientMaxModulePathLength;
    }

    function getModuleRuntimeContext() {
      const studioEmbed = getOwnWindowDataProperty('__veryfrontStudioEmbed') === true;
      const hmrValue = getOwnWindowDataProperty('__veryfrontHMRRefreshTimestamp');
      const releaseValue = getOwnWindowDataProperty('__veryfrontReleaseId');
      const hmrRefreshTimestamp = typeof hmrValue === 'string' && /^[0-9]{1,32}$/.test(hmrValue)
        ? hmrValue
        : null;
      const releaseId = typeof releaseValue === 'string' && releaseValue.length > 0 &&
          releaseValue.length <= __veryfrontClientMaxReleaseIdLength &&
          new TextEncoder().encode(releaseValue).byteLength <= __veryfrontClientMaxReleaseIdLength &&
          !hasUnsafeModulePathCharacter(releaseValue)
        ? releaseValue
        : null;
      return { studioEmbed, hmrRefreshTimestamp, releaseId };
    }

    function hasQueryParameter(url, name) {
      const queryStart = url.indexOf('?');
      const hashStart = url.indexOf('#');
      if (queryStart < 0 || (hashStart >= 0 && queryStart > hashStart)) return false;
      const query = url.slice(queryStart + 1, hashStart < 0 ? undefined : hashStart);
      return query.split('&').some((part) => part.split('=', 1)[0] === name);
    }

    function appendQueryParameter(url, name, value) {
      const hashIndex = url.indexOf('#');
      const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
      const base = hashIndex < 0 ? url : url.slice(0, hashIndex);
      const separator = base.includes('?') ? '&' : '?';
      return base + separator + encodeURIComponent(name) + '=' + encodeURIComponent(value) + hash;
    }

    function applyRuntimeContext(url, context) {
      if (context.studioEmbed) {
        return hasQueryParameter(url, 'studio_embed')
          ? url
          : appendQueryParameter(url, 'studio_embed', 'true');
      }
      if (context.hmrRefreshTimestamp) {
        return hasQueryParameter(url, 't')
          ? url
          : appendQueryParameter(url, 't', context.hmrRefreshTimestamp);
      }
      if (!context.releaseId || hasQueryParameter(url, 'vf_release')) return url;
      const versioned = appendQueryParameter(url, 'vf_release', context.releaseId);
      return hasQueryParameter(versioned, 'vf_runtime')
        ? versioned
        : appendQueryParameter(versioned, 'vf_runtime', __veryfrontClientRuntimeVersion);
    }

    function assertSafeModulePath(path) {
      if (typeof path !== 'string' || !path || exceedsModulePathLimit(path) ||
          hasUnsafeModulePathCharacter(path) || /[<>"']/.test(path)) {
        throw new TypeError('Module path is invalid');
      }
      const pathname = path.replace(/[?#].*$/, '').replace(/^\\/+/, '');
      if (!pathname) throw new TypeError('Module path is invalid');
      for (const segment of pathname.split('/')) {
        const decoded = decodePathSegment(segment);
        if (!decoded || decoded === '.' || decoded === '..' || decoded.includes('/') ||
            decoded.includes('?') || decoded.includes('#') ||
            hasUnsafeModulePathCharacter(decoded) || /[<>"']/.test(decoded)) {
          throw new TypeError('Module path contains an unsafe segment');
        }
      }
    }

    function normalizeModuleBaseUrl(baseUrl) {
      if (typeof baseUrl !== 'string' || !baseUrl || exceedsModulePathLimit(baseUrl) ||
          /[?#]/.test(baseUrl) || hasUnsafeModulePathCharacter(baseUrl) ||
          /[<>"']/.test(baseUrl)) {
        throw new TypeError('Module server URL is invalid');
      }
      if (baseUrl.startsWith('//')) {
        throw new TypeError('Module server URL must not be protocol-relative');
      }
      if (/^[a-zA-Z][a-zA-Z\\d+.-]*:/.test(baseUrl)) {
        const parsed = new URL(baseUrl);
        if (!['file:', 'http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
          throw new TypeError('Module server URL protocol is not allowed');
        }
        const absolutePrefix = baseUrl.match(/^[a-zA-Z][a-zA-Z\\d+.-]*:\\/\\//)?.[0];
        if (!absolutePrefix) throw new TypeError('Module server URL must be absolute');
        const rawPathStart = baseUrl.indexOf('/', absolutePrefix.length);
        const rawPath = rawPathStart < 0
          ? ''
          : baseUrl.slice(rawPathStart).replace(/\\/+$/, '');
        if (rawPath) assertSafeModulePath(rawPath);
        const pathname = parsed.pathname.replace(/\\/+$/, '');
        if (pathname && pathname !== '/') assertSafeModulePath(pathname);
      } else if (baseUrl !== '/') {
        assertSafeModulePath(baseUrl.replace(/\\/+$/, ''));
      }
      if (baseUrl === '/') return '';
      return baseUrl.replace(/\\/+$/, '');
    }

    function joinModuleUrl(baseUrl, modulePath) {
      return normalizeModuleBaseUrl(baseUrl) + '/' + modulePath;
    }

    function validateReleaseAssetUrl(value) {
      if (typeof value !== 'string' || !value || exceedsModulePathLimit(value) ||
          value.startsWith('//') || hasUnsafeModulePathCharacter(value) || /[<>"']/.test(value)) {
        throw new TypeError('Release asset URL is invalid');
      }
      if (value.startsWith('/')) {
        assertSafeModulePath(value);
        if (value.startsWith('/_vf/assets/') &&
            !/^\\/_vf\\/assets\\/[0-9a-f]{64}\\.(?:js|css)(?:[?#].*)?$/.test(value)) {
          throw new TypeError('Release asset URL has an invalid content hash');
        }
        return value;
      }
      const absolutePrefix = value.match(/^https?:\\/\\//i)?.[0];
      if (!absolutePrefix) throw new TypeError('Release asset URL protocol is not allowed');
      const rawPathStart = value.indexOf('/', absolutePrefix.length);
      if (rawPathStart < 0) throw new TypeError('Release asset URL must include a path');
      assertSafeModulePath(value.slice(rawPathStart));
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

    function snapshotReleaseAssetModules(value) {
      if (value == null) return null;
      if (typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Release asset module map must be an object');
      }
      let keys;
      try {
        keys = Reflect.ownKeys(value);
      } catch {
        throw new TypeError('Release asset module map cannot be inspected');
      }
      if (keys.length > __veryfrontClientMaxReleaseAssetModules) {
        throw new TypeError('Release asset module map exceeds the entry limit');
      }

      const snapshot = Object.create(null);
      for (const key of keys) {
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, key);
        } catch {
          throw new TypeError('Release asset module map cannot be inspected');
        }
        if (!descriptor || !descriptor.enumerable) continue;
        if (typeof key !== 'string' || descriptor.get || descriptor.set ||
            !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          throw new TypeError('Release asset module map cannot be inspected');
        }
        if (!key || key.startsWith('/') || normalizeReleaseAssetModulePath(key) !== key) {
          throw new TypeError('Release asset module path is invalid');
        }
        assertSafeModulePath(key);
        Object.defineProperty(snapshot, key, {
          configurable: false,
          enumerable: true,
          value: validateReleaseAssetUrl(descriptor.value),
          writable: false
        });
      }
      return Object.freeze(snapshot);
    }

    function setReleaseAssetModules(value) {
      __veryfrontClientReleaseAssetModules = snapshotReleaseAssetModules(value);
      window.__veryfrontReleaseAssetModules = __veryfrontClientReleaseAssetModules;
    }
    var __veryfrontClientInitialReleaseAssetModules =
      getOwnWindowDataProperty('__veryfrontReleaseAssetModules');
    window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules;
    if (__veryfrontClientInitialReleaseAssetModules != null) {
      setReleaseAssetModules(__veryfrontClientInitialReleaseAssetModules);
    }

    function getOwnReleaseAssetUrl(key) {
      if (!Object.prototype.hasOwnProperty.call(__veryfrontClientReleaseAssetModules, key)) return null;
      return __veryfrontClientReleaseAssetModules[key];
    }

    function resolveReleaseAssetModuleUrl(path, runtimeContext) {
      if (!__veryfrontClientReleaseAssetModules ||
          runtimeContext.studioEmbed || runtimeContext.hmrRefreshTimestamp) return null;

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

    function normalizeModuleRequestPath(path) {
      const key = String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '');
      if (/\\.(tsx|ts|jsx|mdx|md)([?#].*)?$/.test(key)) {
        return key.replace(/\\.(tsx|ts|jsx|mdx|md)([?#].*)?$/, '.js$2');
      }
      if (/\\.(tsx|ts|jsx|mdx|md|js|mjs)([?#].*)?$/.test(key)) return key;
      return key + '.js';
    }

    function pathToModuleUrl(path, baseUrl) {
      assertSafeModulePath(path);
      const runtimeContext = getModuleRuntimeContext();
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path, runtimeContext);
      if (releaseAssetUrl) return releaseAssetUrl;

      const configuredBase = getOwnWindowDataProperty('MODULE_SERVER_URL');
      const base = baseUrl === undefined
        ? (configuredBase === undefined ? '/_vf_modules' : configuredBase)
        : baseUrl;
      if (/^\\/?_vf_modules\\//.test(path)) {
        return applyRuntimeContext(
          joinModuleUrl(base, normalizeModuleRequestPath(path)),
          runtimeContext
        );
      }

      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx|md)([?#].*)?$/;
      let match = path.match(new RegExp('/' + pattern.source));
      match = match || path.match(new RegExp('^' + pattern.source));
      if (match) {
        return applyRuntimeContext(
          joinModuleUrl(base, match[1] + '/' + match[2] + '.js' + (match[4] || '')),
          runtimeContext
        );
      }
      return applyRuntimeContext(
        joinModuleUrl(base, normalizeModuleRequestPath(path)),
        runtimeContext
      );
    }
  `.trim();
}
