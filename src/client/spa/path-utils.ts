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
const KNOWN_EXT_PATTERN = /\.(tsx|ts|jsx|mdx|js|mjs)([?#].*)?$/;
const SOURCE_EXT_REPLACE_PATTERN = /\.(tsx|ts|jsx|mdx)([?#].*)?$/;

/** Precomputed regex for absolute paths containing a source directory */
const ABSOLUTE_SOURCE_PATH_PATTERN = new RegExp(`/${SOURCE_PATH_PATTERN.source}`);

/** Precomputed regex for relative paths starting with a source directory */
const RELATIVE_SOURCE_PATH_PATTERN = new RegExp(`^${SOURCE_PATH_PATTERN.source}`);

type ReleaseAssetGlobal = typeof globalThis & {
  __veryfrontReleaseAssetModules?: Record<string, string> | null;
  __veryfrontStudioEmbed?: boolean;
  __veryfrontHMRRefreshTimestamp?: string | null;
};

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
    !releaseAssetModules || globalRecord.__veryfrontStudioEmbed ||
    globalRecord.__veryfrontHMRRefreshTimestamp
  ) {
    return null;
  }

  const key = normalizeReleaseAssetModulePath(path);
  if (releaseAssetModules[key]) return releaseAssetModules[key];

  const withoutExt = key.replace(/\.(tsx|ts|jsx|mdx|js|mjs)$/, "");
  for (const ext of [".tsx", ".ts", ".jsx", ".mdx", ".js"]) {
    const candidate = withoutExt + ext;
    if (releaseAssetModules[candidate]) return releaseAssetModules[candidate];
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

export function getModuleServerUrl(): string {
  if (typeof window === "undefined") return "/_vf_modules";
  return (globalThis as typeof globalThis & { MODULE_SERVER_URL?: string }).MODULE_SERVER_URL ??
    "/_vf_modules";
}

export function pathToModuleUrl(path: string, baseUrl?: string): string {
  const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
  if (releaseAssetUrl) return releaseAssetUrl;

  const base = baseUrl ?? getModuleServerUrl();

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

    function normalizeReleaseAssetModulePath(path) {
      return String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '')
        .replace(/[?#].*$/, '');
    }

    function resolveReleaseAssetModuleUrl(path) {
      const releaseAssetModules = window.__veryfrontReleaseAssetModules;
      if (!releaseAssetModules || window.__veryfrontStudioEmbed || window.__veryfrontHMRRefreshTimestamp) {
        return null;
      }

      const key = normalizeReleaseAssetModulePath(path);
      if (releaseAssetModules[key]) return releaseAssetModules[key];

      const withoutExt = key.replace(/\\.(tsx|ts|jsx|mdx|js|mjs)$/, '');
      const extensions = ['.tsx', '.ts', '.jsx', '.mdx', '.js'];
      for (const ext of extensions) {
        const candidate = withoutExt + ext;
        if (releaseAssetModules[candidate]) return releaseAssetModules[candidate];
      }

      return null;
    }

    function normalizeModuleRequestPath(path) {
      const key = String(path || '')
        .replace(/^\\/?_vf_modules\\//, '')
        .replace(/^\\/+/, '');

      if (/\\.(tsx|ts|jsx|mdx)([?#].*)?$/.test(key)) {
        return key.replace(/\\.(tsx|ts|jsx|mdx)([?#].*)?$/, '.js$2');
      }

      if (/\\.(tsx|ts|jsx|mdx|js|mjs)([?#].*)?$/.test(key)) {
        return key;
      }

      return key + '.js';
    }

    function pathToModuleUrl(path, baseUrl) {
      const releaseAssetUrl = resolveReleaseAssetModuleUrl(path);
      if (releaseAssetUrl) return releaseAssetUrl;

      const base = baseUrl || MODULE_SERVER_URL;
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
