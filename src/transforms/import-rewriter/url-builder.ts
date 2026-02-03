/**
 * URL builders for import rewriting.
 */

export const DEFAULT_REACT_VERSION = "19.1.1";
export const TAILWIND_VERSION = "4.1.8";

type EsmShOptions = {
  external?: string[];
  target?: string;
  deps?: Record<string, string>;
};

export function buildEsmShUrl(
  pkg: string,
  version?: string,
  subpath?: string,
  options?: EsmShOptions,
): string {
  const params: string[] = [];

  if (options?.external?.length) {
    params.push(`external=${options.external.join(",")}`);
  }

  params.push(`target=${options?.target ?? "es2022"}`);

  if (options?.deps) {
    const depsStr = Object.entries(options.deps)
      .map(([k, v]) => `${k}@${v}`)
      .join(",");
    params.push(`deps=${depsStr}`);
  }

  const versionStr = version ? `@${version}` : "";
  const pathStr = subpath ?? "";
  const queryStr = params.length ? `?${params.join("&")}` : "";

  return `https://esm.sh/${pkg}${versionStr}${pathStr}${queryStr}`;
}

/**
 * Build React esm.sh URL using DIRECT PATH format to match esm.sh internal imports.
 *
 * CRITICAL: Deno caches modules by FETCH URL, not internal path!
 *
 * Third-party packages built with deps=react@19.1.1 import React as:
 *   import "/react@19.1.1/es2022/react.mjs"  (direct path on esm.sh)
 *
 * If we use query params like ?target=es2022, Deno caches it as a DIFFERENT module:
 *   https://esm.sh/react@19.1.1?target=es2022  ← different cache entry!
 *   https://esm.sh/react@19.1.1/es2022/react.mjs  ← what packages use
 *
 * Using direct paths ensures ALL React imports hit the same Deno module cache entry.
 */
export function buildReactUrl(
  pkg: "react" | "react-dom",
  version: string,
  subpath?: string,
  _external = false,
): string {
  // Use direct path format that matches esm.sh internal imports
  if (pkg === "react") {
    if (!subpath) return `https://esm.sh/react@${version}/es2022/react.mjs`;
    const sub = subpath.replace(/^\//, "");
    return `https://esm.sh/react@${version}/es2022/${sub}.mjs`;
  }

  // react-dom - use direct path format
  if (!subpath) return `https://esm.sh/react-dom@${version}/es2022/react-dom.mjs`;
  const sub = subpath.replace(/^\//, "");
  return `https://esm.sh/react-dom@${version}/es2022/${sub}.mjs`;
}

export function getReactImportMap(version: string): Record<string, string> {
  // Use direct path format to match esm.sh internal imports
  return {
    react: `https://esm.sh/react@${version}/es2022/react.mjs`,
    "react/jsx-runtime": `https://esm.sh/react@${version}/es2022/jsx-runtime.mjs`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${version}/es2022/jsx-dev-runtime.mjs`,
    "react/": `https://esm.sh/react@${version}/es2022/`,
    "react-dom": `https://esm.sh/react-dom@${version}/es2022/react-dom.mjs`,
    "react-dom/client": `https://esm.sh/react-dom@${version}/es2022/client.mjs`,
    "react-dom/server": `https://esm.sh/react-dom@${version}/es2022/server.mjs`,
  };
}

export function buildModuleServerUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

export function buildCrossProjectUrl(
  projectSlug: string,
  version: string | null,
  path: string,
): string {
  const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
  const projectRef = version && version !== "latest" ? `${projectSlug}@${version}` : projectSlug;
  return `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;
}

export function buildVeryfrontModuleUrl(path: string): string {
  const normalizedPath = path.replace(/\.(tsx?|jsx)$/, ".js");
  return `/_vf_modules/_veryfront/${normalizedPath}`;
}

export function normalizeExtension(path: string, options?: { removeExtension?: boolean }): string {
  if (options?.removeExtension) return path.replace(/\.(tsx?|jsx|mdx)$/, "");
  return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
}

export function isEsmShUrl(url: string): boolean {
  return url.startsWith("https://esm.sh/") || url.startsWith("http://esm.sh/");
}

export function addEsmShDeps(url: string, reactVersion: string): string {
  if (!isEsmShUrl(url) || url.includes(`react@${reactVersion}`) || url.includes("?")) {
    return url;
  }
  // Use deps= to pin React version. Do NOT use external= which causes bare imports
  // that resolve to the latest React at runtime, breaking context sharing.
  return `${url}?deps=react@${reactVersion},react-dom@${reactVersion}&target=es2022`;
}
