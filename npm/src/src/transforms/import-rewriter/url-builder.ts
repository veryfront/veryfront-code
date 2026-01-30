/**
 * Canonical URL builders for import rewriting.
 *
 * Single source of truth for all URL generation.
 * Ensures consistent URLs across SSR and browser for hydration parity.
 */

/** Default React version - used when not specified */
export const DEFAULT_REACT_VERSION = "19.1.1";

/** Tailwind CSS version */
export const TAILWIND_VERSION = "4.1.8";

/** csstype version - must match deno.json for type consistency */
export const CSSTYPE_VERSION = "3.2.3";

/**
 * Build esm.sh URL with proper configuration.
 *
 * @param pkg - Package name (e.g., "react", "lodash")
 * @param version - Package version (optional)
 * @param subpath - Subpath (e.g., "/jsx-runtime")
 * @param options - URL options
 */
export function buildEsmShUrl(
  pkg: string,
  version?: string,
  subpath?: string,
  options?: {
    external?: string[];
    target?: string;
    deps?: Record<string, string>;
  },
): string {
  const params: string[] = [];

  // Add external packages first (for consistency with existing URLs)
  if (options?.external?.length) {
    params.push(`external=${options.external.join(",")}`);
  }

  // Add target (always include for consistent builds)
  params.push(`target=${options?.target ?? "es2022"}`);

  // Add deps
  if (options?.deps) {
    const depsStr = Object.entries(options.deps)
      .map(([k, v]) => `${k}@${v}`)
      .join(",");
    params.push(`deps=${depsStr}`);
  }

  const versionStr = version ? `@${version}` : "";
  const pathStr = subpath ?? "";
  const queryStr = params.length > 0 ? `?${params.join("&")}` : "";

  return `https://esm.sh/${pkg}${versionStr}${pathStr}${queryStr}`;
}

/**
 * Build React esm.sh URL.
 * Uses deps=csstype for type consistency.
 */
export function buildReactUrl(
  pkg: "react" | "react-dom",
  version: string,
  subpath?: string,
  external = false,
): string {
  return buildEsmShUrl(pkg, version, subpath, {
    external: external ? ["react"] : undefined,
    deps: { csstype: CSSTYPE_VERSION },
  });
}

/**
 * Get complete React import map for a specific version.
 */
export function getReactImportMap(version: string): Record<string, string> {
  return {
    react: buildReactUrl("react", version),
    "react-dom": buildReactUrl("react-dom", version, undefined, true),
    "react-dom/client": buildReactUrl("react-dom", version, "/client", true),
    "react-dom/server": buildReactUrl("react-dom", version, "/server", true),
    "react/jsx-runtime": buildReactUrl("react", version, "/jsx-runtime", true),
    "react/jsx-dev-runtime": buildReactUrl("react", version, "/jsx-dev-runtime", true),
    // Prefix match for any react/* subpath imports
    "react/": buildReactUrl("react", version, "/", true),
  };
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
export function normalizeExtension(
  path: string,
  options?: { removeExtension?: boolean },
): string {
  if (options?.removeExtension) {
    return path.replace(/\.(tsx?|jsx|mdx)$/, "");
  }
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
  // Skip React packages (they already have correct deps)
  if (url.includes(`react@${reactVersion}`)) return url;
  // Skip if already has query params
  if (url.includes("?")) return url;

  return `${url}?external=react,react-dom&target=es2022`;
}
