/****
 * Shared path utilities for SPA module resolution.
 * Used by component-loader.ts and hydration script templates.
 */

import { hasControlCharacters, MAX_SPA_RESOURCE_KEY_LENGTH } from "./validation.ts";

/** Supported source directories for module resolution */
const SOURCE_DIRS = ["pages", "components", "app", "lib", "layouts", "shared", "features"] as const;

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ["tsx", "ts", "jsx", "mdx", "md", "js", "mjs"] as const;
const RELEASE_ASSET_SOURCE_SUFFIXES = SOURCE_EXTENSIONS.map((extension) => `.${extension}`);

/** Regex pattern for matching source paths */
const SOURCE_PATH_PATTERN = new RegExp(
  `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})$`,
);

const MODULE_SERVER_PATH_PATTERN = /^\/?_vf_modules\//;
const AUTHORED_SOURCE_EXT_PATTERN = new RegExp(
  `\\.(${SOURCE_EXTENSIONS.join("|")})$`,
);
const JAVASCRIPT_SOURCE_EXT_PATTERN = /\.(js|mjs)$/;
const MAX_MODULE_PATH_LENGTH = MAX_SPA_RESOURCE_KEY_LENGTH;
const MAX_MODULE_BASE_URL_LENGTH = MAX_MODULE_PATH_LENGTH * 2;

/** Precomputed regex for absolute paths containing a source directory */
const ABSOLUTE_SOURCE_PATH_PATTERN = new RegExp(`/${SOURCE_PATH_PATTERN.source}`);

/** Precomputed regex for relative paths starting with a source directory */
const RELATIVE_SOURCE_PATH_PATTERN = new RegExp(`^${SOURCE_PATH_PATTERN.source}`);

type ReleaseAssetGlobal = typeof globalThis & {
  __veryfrontReleaseAssetModules?: unknown;
  __veryfrontStudioEmbed?: boolean;
  __veryfrontHMRRefreshTimestamp?: string | null;
};

function decodeTraversalDelimiters(value: string): string {
  return value.replace(/%(25|2e|2f|5c)/gi, (_match, code: string) => {
    switch (code.toLowerCase()) {
      case "25":
        return "%";
      case "2e":
        return ".";
      case "2f":
        return "/";
      default:
        return "\\";
    }
  });
}

function assertSafeModulePath(path: string): void {
  if (typeof path !== "string") throw new TypeError("Module path must be a string");
  if (
    path.length === 0 || path.length > MAX_MODULE_PATH_LENGTH ||
    hasControlCharacters(path)
  ) {
    throw new TypeError(
      `Module path must contain 1-${MAX_MODULE_PATH_LENGTH} control-free characters`,
    );
  }

  let candidate = path.split(/[?#]/, 1)[0] ?? "";
  for (let depth = 0; depth < 5; depth++) {
    if (candidate.split(/[\\/]/).some((segment) => segment === "..")) {
      throw new TypeError("Module path must not contain path traversal");
    }

    const decoded = decodeTraversalDelimiters(candidate);
    if (decoded === candidate) {
      if (candidate.includes("\\")) {
        throw new TypeError("Module path must use forward slashes");
      }
      return;
    }
    candidate = decoded;
  }

  throw new TypeError("Module path contains excessive nested encoding");
}

function normalizeModuleBaseUrl(value: unknown): string {
  if (
    typeof value !== "string" || value.length > MAX_MODULE_BASE_URL_LENGTH ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(
      `Module server URL must contain at most ${MAX_MODULE_BASE_URL_LENGTH} control-free characters`,
    );
  }
  return value.replace(/\/+$/, "");
}

function readOwnReleaseAssetUrl(value: object, key: string): string | null {
  try {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate.length <= MAX_MODULE_BASE_URL_LENGTH &&
        !hasControlCharacters(candidate)
      ? candidate
      : null;
  } catch {
    // Browser globals can be replaced by application code. Treat hostile or
    // malformed maps as a cache miss instead of letting lookup break loading.
    return null;
  }
}

function normalizeReleaseAssetModulePath(path: string): string {
  return String(path || "")
    .replace(/^\/?_vf_modules\//, "")
    .replace(/^\/+/, "")
    .replace(/[?#].*$/, "");
}

function resolveReleaseAssetModuleUrl(path: string): string | null {
  const globalRecord = globalThis as ReleaseAssetGlobal;
  const releaseAssetModules = globalRecord.__veryfrontReleaseAssetModules;
  if (
    typeof releaseAssetModules !== "object" || releaseAssetModules === null ||
    Array.isArray(releaseAssetModules) || globalRecord.__veryfrontStudioEmbed ||
    globalRecord.__veryfrontHMRRefreshTimestamp
  ) {
    return null;
  }

  const key = normalizeReleaseAssetModulePath(path);
  const exactUrl = readOwnReleaseAssetUrl(releaseAssetModules, key);
  if (exactUrl) return exactUrl;

  // An authored extension identifies exactly one source module. Falling
  // through to a sibling extension can execute code that was not requested.
  if (AUTHORED_SOURCE_EXT_PATTERN.test(key)) return null;

  for (const ext of RELEASE_ASSET_SOURCE_SUFFIXES) {
    const candidate = key + ext;
    const candidateUrl = readOwnReleaseAssetUrl(releaseAssetModules, candidate);
    if (candidateUrl) return candidateUrl;
  }

  return null;
}

interface ModulePathParts {
  path: string;
  suffix: string;
}

function splitModulePathSuffix(value: string): ModulePathParts {
  const suffixIndex = value.search(/[?#]/);
  return suffixIndex === -1
    ? { path: value, suffix: "" }
    : { path: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
}

function stripModuleServerPrefix(path: string): string {
  return path
    .replace(MODULE_SERVER_PATH_PATTERN, "")
    .replace(/^\/+/, "");
}

function normalizeModuleIdentity(key: string): string {
  if (JAVASCRIPT_SOURCE_EXT_PATTERN.test(key)) return key;
  if (AUTHORED_SOURCE_EXT_PATTERN.test(key)) {
    return key.replace(AUTHORED_SOURCE_EXT_PATTERN, ".js");
  }
  return `${key}.js`;
}

function normalizeExistingModuleRequestPath(path: string): string {
  const parts = splitModulePathSuffix(path);
  const key = stripModuleServerPrefix(parts.path);

  return `${normalizeModuleIdentity(key)}${parts.suffix}`;
}

function normalizeLogicalModulePath(path: string): string {
  const parts = splitModulePathSuffix(path);
  const match = parts.path.match(ABSOLUTE_SOURCE_PATH_PATTERN) ??
    parts.path.match(RELATIVE_SOURCE_PATH_PATTERN);

  if (!match) return `${stripModuleServerPrefix(parts.path)}${parts.suffix}`;
  return `${match[1]}/${match[2]}.${match[3]}${parts.suffix}`;
}

function normalizeLogicalModuleRequestPath(path: string): string {
  const parts = splitModulePathSuffix(normalizeLogicalModulePath(path));
  const key = stripModuleServerPrefix(parts.path);

  return `${normalizeModuleIdentity(key)}${parts.suffix}`;
}

export function getModuleServerUrl(): string {
  if (typeof window === "undefined") return "/_vf_modules";
  return (globalThis as typeof globalThis & { MODULE_SERVER_URL?: string }).MODULE_SERVER_URL ??
    "/_vf_modules";
}

export function pathToModuleUrl(path: string, baseUrl?: string): string {
  assertSafeModulePath(path);
  const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
  if (releaseAssetUrl) return releaseAssetUrl;

  const base = normalizeModuleBaseUrl(baseUrl ?? getModuleServerUrl());

  if (MODULE_SERVER_PATH_PATTERN.test(path)) {
    return `${base}/${normalizeExistingModuleRequestPath(path)}`;
  }

  return `${base}/${normalizeLogicalModuleRequestPath(path)}`;
}

export function getPathToModuleUrlScript(): string {
  return `
    function setReleaseAssetModules(value) {
      window.__veryfrontReleaseAssetModules =
        value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    }
    window.__veryfrontSetReleaseAssetModules = setReleaseAssetModules;

    function decodeTraversalDelimiters(value) {
      return value.replace(/%(25|2e|2f|5c)/gi, (_match, code) => {
        switch (code.toLowerCase()) {
          case '25': return '%';
          case '2e': return '.';
          case '2f': return '/';
          default: return '\\\\';
        }
      });
    }

    function assertSafeModulePath(path) {
      if (typeof path !== 'string') throw new TypeError('Module path must be a string');
      if (
        path.length === 0 || path.length > ${MAX_MODULE_PATH_LENGTH} ||
        hasControlCharacters(path)
      ) {
        throw new TypeError(
          'Module path must contain 1-${MAX_MODULE_PATH_LENGTH} control-free characters'
        );
      }

      let candidate = path.split(/[?#]/, 1)[0] || '';
      for (let depth = 0; depth < 5; depth++) {
        if (candidate.split(/[\\\\/]/).some((segment) => segment === '..')) {
          throw new TypeError('Module path must not contain path traversal');
        }

        const decoded = decodeTraversalDelimiters(candidate);
        if (decoded === candidate) {
          if (candidate.includes('\\\\')) {
            throw new TypeError('Module path must use forward slashes');
          }
          return;
        }
        candidate = decoded;
      }

      throw new TypeError('Module path contains excessive nested encoding');
    }

    function hasControlCharacters(value) {
      for (let index = 0; index < value.length; index++) {
        const codeUnit = value.charCodeAt(index);
        if (codeUnit <= 31 || codeUnit === 127) return true;
      }
      return false;
    }

    function normalizeModuleBaseUrl(value) {
      if (
        typeof value !== 'string' || value.length > ${MAX_MODULE_BASE_URL_LENGTH} ||
        hasControlCharacters(value)
      ) {
        throw new TypeError(
          'Module server URL must contain at most ${MAX_MODULE_BASE_URL_LENGTH} control-free characters'
        );
      }
      return value.replace(/\\/+$/, '');
    }

    function normalizeReleaseAssetModulePath(path) {
      return String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '')
        .replace(/[?#].*$/, '');
    }

    function readOwnReleaseAssetUrl(value, key) {
      try {
        if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
        const candidate = value[key];
        return typeof candidate === 'string' &&
            candidate.length > 0 &&
            candidate.length <= ${MAX_MODULE_BASE_URL_LENGTH} &&
            !hasControlCharacters(candidate)
          ? candidate
          : null;
      } catch {
        return null;
      }
    }

    function resolveReleaseAssetModuleUrl(path) {
      const releaseAssetModules = window.__veryfrontReleaseAssetModules;
      if (
        typeof releaseAssetModules !== 'object' || releaseAssetModules === null ||
        Array.isArray(releaseAssetModules) || window.__veryfrontStudioEmbed ||
        window.__veryfrontHMRRefreshTimestamp
      ) {
        return null;
      }

      const key = normalizeReleaseAssetModulePath(path);
      const exactUrl = readOwnReleaseAssetUrl(releaseAssetModules, key);
      if (exactUrl) return exactUrl;

      const authoredSourceExtensionPattern = new RegExp(${
    JSON.stringify(AUTHORED_SOURCE_EXT_PATTERN.source)
  });
      if (authoredSourceExtensionPattern.test(key)) return null;

      const extensions = ${JSON.stringify(RELEASE_ASSET_SOURCE_SUFFIXES)};
      for (const ext of extensions) {
        const candidate = key + ext;
        const candidateUrl = readOwnReleaseAssetUrl(releaseAssetModules, candidate);
        if (candidateUrl) return candidateUrl;
      }

      return null;
    }

    const authoredSourceExtensionPattern = new RegExp(${
    JSON.stringify(AUTHORED_SOURCE_EXT_PATTERN.source)
  });
    const javascriptSourceExtensionPattern = new RegExp(${
    JSON.stringify(JAVASCRIPT_SOURCE_EXT_PATTERN.source)
  });
    const moduleServerPathPattern = /^\\/?_vf_modules\\//;

    function splitModulePathSuffix(value) {
      const suffixIndex = value.search(/[?#]/);
      return suffixIndex === -1
        ? { path: value, suffix: '' }
        : { path: value.slice(0, suffixIndex), suffix: value.slice(suffixIndex) };
    }

    function stripModuleServerPrefix(path) {
      return path.replace(moduleServerPathPattern, '').replace(/^\\/+/, '');
    }

    function normalizeModuleIdentity(key) {
      if (javascriptSourceExtensionPattern.test(key)) return key;
      if (authoredSourceExtensionPattern.test(key)) {
        return key.replace(authoredSourceExtensionPattern, '.js');
      }
      return key + '.js';
    }

    function normalizeExistingModuleRequestPath(path) {
      const parts = splitModulePathSuffix(path);
      const key = stripModuleServerPrefix(parts.path);
      return normalizeModuleIdentity(key) + parts.suffix;
    }

    function normalizeLogicalModulePath(path) {
      const parts = splitModulePathSuffix(path);
      const pattern = new RegExp(${
    JSON.stringify(
      `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})$`,
    )
  });
      let match = parts.path.match(new RegExp('/' + pattern.source));
      match = match || parts.path.match(new RegExp('^' + pattern.source));
      if (!match) return stripModuleServerPrefix(parts.path) + parts.suffix;
      return match[1] + '/' + match[2] + '.' + match[3] + parts.suffix;
    }

    function normalizeLogicalModuleRequestPath(path) {
      const parts = splitModulePathSuffix(normalizeLogicalModulePath(path));
      const key = stripModuleServerPrefix(parts.path);
      return normalizeModuleIdentity(key) + parts.suffix;
    }

    function pathToModuleUrl(path, baseUrl) {
      assertSafeModulePath(path);
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
      if (releaseAssetUrl) return releaseAssetUrl;

      const base = normalizeModuleBaseUrl(baseUrl ?? MODULE_SERVER_URL);
      if (/^\\/?_vf_modules\\//.test(path)) {
        return base + '/' + normalizeExistingModuleRequestPath(path);
      }

      return base + '/' + normalizeLogicalModuleRequestPath(path);
    }
  `.trim();
}
