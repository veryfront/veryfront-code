/****
 * Shared path utilities for SPA module resolution.
 * Used by component-loader.ts and hydration script templates.
 */

/** Supported source directories for module resolution */
const SOURCE_DIRS = ["pages", "components", "app", "lib", "layouts", "shared", "features"] as const;

/** Supported source file extensions */
const SOURCE_EXTENSIONS = ["tsx", "ts", "jsx", "mdx"] as const;

/** Regex pattern for matching source paths */
const SOURCE_PATH_PATTERN = new RegExp(
  `(${SOURCE_DIRS.join("|")})/(.+)\\.(${SOURCE_EXTENSIONS.join("|")})([?#].*)?$`,
);

const MODULE_SERVER_PATH_PATTERN = /^\/?_vf_modules\//;
const KNOWN_EXT_PATTERN = /\.(tsx|ts|jsx|mdx|js|mjs)$/;
const SOURCE_EXT_REPLACE_PATTERN = /\.(tsx|ts|jsx|mdx)$/;

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

  let candidate = path.split(/[?#]/, 1)[0] ?? "";
  for (let depth = 0; depth < 5; depth++) {
    if (candidate.split(/[\\/]/).some((segment) => segment === "..")) {
      throw new TypeError("Module path must not contain path traversal");
    }

    const decoded = decodeTraversalDelimiters(candidate);
    if (decoded === candidate) return;
    candidate = decoded;
  }

  throw new TypeError("Module path contains excessive nested encoding");
}

function readOwnReleaseAssetUrl(value: object, key: string): string | null {
  try {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return null;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
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

  const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|js|mjs)$/, "");
  for (const ext of [".tsx", ".ts", ".jsx", ".mdx", ".js"]) {
    const candidate = withoutExt + ext;
    const candidateUrl = readOwnReleaseAssetUrl(releaseAssetModules, candidate);
    if (candidateUrl) return candidateUrl;
  }

  return null;
}

function normalizeModuleRequestPath(path: string): string {
  const value = String(path || "");
  const suffixIndex = value.search(/[?#]/);
  const suffix = suffixIndex === -1 ? "" : value.slice(suffixIndex);
  const key = (suffixIndex === -1 ? value : value.slice(0, suffixIndex))
    .replace(MODULE_SERVER_PATH_PATTERN, "")
    .replace(/^\/+/, "");

  if (SOURCE_EXT_REPLACE_PATTERN.test(key)) {
    return `${key.replace(SOURCE_EXT_REPLACE_PATTERN, ".js")}${suffix}`;
  }

  if (KNOWN_EXT_PATTERN.test(key)) {
    return `${key}${suffix}`;
  }

  return `${key}.js${suffix}`;
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

  const base = (baseUrl ?? getModuleServerUrl()).replace(/\/+$/, "");

  if (MODULE_SERVER_PATH_PATTERN.test(path)) {
    return `${base}/${normalizeModuleRequestPath(path)}`;
  }

  const match = path.match(ABSOLUTE_SOURCE_PATH_PATTERN) ??
    path.match(RELATIVE_SOURCE_PATH_PATTERN);

  if (match) {
    return `${base}/${match[1]}/${match[2]}.js${match[4] ?? ""}`;
  }

  return `${base}/${normalizeModuleRequestPath(path)}`;
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

      let candidate = path.split(/[?#]/, 1)[0] || '';
      for (let depth = 0; depth < 5; depth++) {
        if (candidate.split(/[\\\\/]/).some((segment) => segment === '..')) {
          throw new TypeError('Module path must not contain path traversal');
        }

        const decoded = decodeTraversalDelimiters(candidate);
        if (decoded === candidate) return;
        candidate = decoded;
      }

      throw new TypeError('Module path contains excessive nested encoding');
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
        return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
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

      const withoutExt = key.replace(/\\.(tsx|ts|jsx|mdx|js|mjs)$/, '');
      const extensions = ['.tsx', '.ts', '.jsx', '.mdx', '.js'];
      for (const ext of extensions) {
        const candidate = withoutExt + ext;
        const candidateUrl = readOwnReleaseAssetUrl(releaseAssetModules, candidate);
        if (candidateUrl) return candidateUrl;
      }

      return null;
    }

    function normalizeModuleRequestPath(path) {
      const value = String(path || '');
      const suffixIndex = value.search(/[?#]/);
      const suffix = suffixIndex === -1 ? '' : value.slice(suffixIndex);
      const key = (suffixIndex === -1 ? value : value.slice(0, suffixIndex))
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '');

      if (/\\.(tsx|ts|jsx|mdx)$/.test(key)) {
        return key.replace(/\\.(tsx|ts|jsx|mdx)$/, '.js') + suffix;
      }

      if (/\\.(tsx|ts|jsx|mdx|js|mjs)$/.test(key)) {
        return key + suffix;
      }

      return key + '.js' + suffix;
    }

    function pathToModuleUrl(path, baseUrl) {
      assertSafeModulePath(path);
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
      if (releaseAssetUrl) return releaseAssetUrl;

      const base = (baseUrl ?? MODULE_SERVER_URL).replace(/\\/+$/, '');
      if (/^\\/?_vf_modules\\//.test(path)) {
        return base + '/' + normalizeModuleRequestPath(path);
      }

      const pattern = /(pages|components|app|lib|layouts|shared|features)\\/(.+)\\.(tsx|ts|jsx|mdx)([?#].*)?$/;

      let match = path.match(new RegExp('/' + pattern.source));
      match = match || path.match(new RegExp('^' + pattern.source));

      if (match) {
        return base + '/' + match[1] + '/' + match[2] + '.js' + (match[4] || '');
      }

      return base + '/' + normalizeModuleRequestPath(path);
    }
  `.trim();
}
