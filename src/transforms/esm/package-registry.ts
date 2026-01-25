/**
 * Central package version and URL registry.
 *
 * Single source of truth for all package versions used in both SSR and browser transforms.
 * SSR resolves to esm.sh URLs (then cached to file://), browser uses esm.sh URLs.
 */

export const REACT_VERSION = "19.1.1";
export const TAILWIND_VERSION = "4.1.8";

/**
 * Transform cache version - bump when transform logic changes.
 * This invalidates all cached modules (local + Redis) to prevent stale transform issues.
 * See: https://github.com/veryfront/veryfront-renderer/issues/79
 *
 * v2: Skip ssr-http-cache on Deno for cross-pod compatibility
 * v3: Use HTTP imports in shared React modules on Deno
 */
export const TRANSFORM_CACHE_VERSION = 3;

function esmSh(pkg: string, version: string, path = "", query = "target=es2022"): string {
  return `https://esm.sh/${pkg}@${version}${path}?${query}`;
}

/**
 * Generate esm.sh URL for browser.
 * Uses ?external= so browser import map provides React (ensures single instance).
 * Uses ?target=es2022 for consistent builds.
 */
export function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string {
  const params = ["target=es2022"];
  if (external?.length) params.push(`external=${external.join(",")}`);
  return `https://esm.sh/${pkg}@${version}?${params.join("&")}`;
}

/**
 * Get React esm.sh URLs with consistent versioning.
 * Used by both SSR and browser for full-stack consistency.
 * Uses ?target=es2022 to ensure identical builds (esm.sh auto-detects target otherwise).
 *
 * @param version - React version to use (defaults to REACT_VERSION)
 */
export function getReactUrls(version: string = REACT_VERSION): Record<string, string> {
  return {
    react: esmSh("react", version),
    "react-dom": esmSh("react-dom", version),
    "react-dom/client": esmSh("react-dom", version, "/client"),
    "react-dom/server": esmSh("react-dom", version, "/server"),
    "react/jsx-runtime": esmSh("react", version, "/jsx-runtime"),
    "react/jsx-dev-runtime": esmSh("react", version, "/jsx-dev-runtime"),
  };
}

/**
 * Get complete React import map for esm.sh.
 * This is used by BOTH SSR and browser to ensure identical React instances,
 * preventing hydration mismatches.
 *
 * Works in Deno, Node, and Bun since esm.sh URLs are standard HTTPS imports.
 * Uses ?target=es2022 to ensure identical builds across all runtimes.
 *
 * @param version - React version to use (defaults to REACT_VERSION)
 */
export function getReactImportMap(version: string = REACT_VERSION): Record<string, string> {
  return {
    ...getReactUrls(version),
    // Prefix match for any react/* subpath imports
    "react/": esmSh("react", version, "/"),
  };
}
