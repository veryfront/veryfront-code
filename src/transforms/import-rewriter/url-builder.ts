/**
 * Canonical URL builders for import rewriting.
 *
 * Single source of truth for all URL generation.
 * Ensures consistent URLs across SSR and browser for hydration parity.
 */

import {
  buildEsmShUrl,
  buildReactUrl,
  CSSTYPE_VERSION,
  getReactImportMap as getSharedReactImportMap,
  REACT_DEFAULT_VERSION,
  TAILWIND_VERSION,
} from "#veryfront/utils/constants/cdn.ts";

export { buildEsmShUrl, buildReactUrl, CSSTYPE_VERSION, TAILWIND_VERSION };

/**
 * Default React version - used when not specified.
 *
 * MUST match the React version the build bundles (see `react/deno.json`),
 * because veryfront's framework React re-export is generated against that
 * version and references its named exports. A drift guard in
 * `src/utils/constants/cdn.test.ts` enforces this.
 */
export const DEFAULT_REACT_VERSION = REACT_DEFAULT_VERSION;

/**
 * Get complete React import map for a specific version.
 */
export function getReactImportMap(version: string): Record<string, string> {
  return getSharedReactImportMap(version);
}

/**
 * Build module server URL for a path.
 */
export function buildModuleServerUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

/**
 * Build cross-project import URL.
 */
export function buildCrossProjectUrl(
  projectSlug: string,
  version: string | null,
  path: string,
): string {
  const modulePath = /\.(js|mjs|jsx|ts|tsx|mdx)$/.test(path) ? path : `${path}.tsx`;
  const projectRef = version && version !== "latest" ? `${projectSlug}@${version}` : projectSlug;
  return `/_vf_modules/_cross/${projectRef}/@/${modulePath}`;
}

/**
 * Build veryfront framework module URL.
 */
export function buildVeryfrontModuleUrl(path: string): string {
  const normalizedPath = path.replace(/\.(tsx?|jsx)$/, ".js");
  return `/_vf_modules/_veryfront/${normalizedPath}`;
}

/**
 * Normalize file extension for JavaScript output.
 */
export function normalizeExtension(path: string, options?: { removeExtension?: boolean }): string {
  if (options?.removeExtension) return path.replace(/\.(tsx?|jsx|mdx)$/, "");
  return path.replace(/\.(tsx?|jsx|mdx)$/, ".js");
}

/**
 * Check if a URL is an esm.sh URL.
 */
export function isEsmShUrl(url: string): boolean {
  return url.startsWith("https://esm.sh/") || url.startsWith("http://esm.sh/");
}

/**
 * Add deps query param to esm.sh URL if not already present.
 */
export function addEsmShDeps(url: string, reactVersion: string): string {
  if (!isEsmShUrl(url)) return url;
  if (url.includes(`react@${reactVersion}`)) return url;

  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const externals = new Set<string>();

    for (const value of params.getAll("external")) {
      for (const external of value.split(",")) {
        const normalized = external.trim();
        if (normalized) externals.add(normalized);
      }
    }

    for (const external of ["react", "react-dom"]) {
      if (params.has(external)) {
        externals.add(external);
        params.delete(external);
      }
      externals.add(external);
    }

    const orderedExternals = [
      "react",
      "react-dom",
      ...Array.from(externals).filter((external) =>
        external !== "react" && external !== "react-dom"
      ),
    ];
    const target = params.get("target") ?? "es2022";
    params.delete("external");
    params.delete("target");

    const query = [
      `external=${orderedExternals.join(",")}`,
      `target=${target}`,
      ...Array.from(params.entries()).map(([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      ),
    ].join("&");

    return `${parsed.origin}${parsed.pathname}?${query}${parsed.hash}`;
  } catch (_) {
    /* expected: malformed URL falls back to the original string */
    return url;
  }
}
