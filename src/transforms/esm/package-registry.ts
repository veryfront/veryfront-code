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
 */
export const TRANSFORM_CACHE_VERSION = 2;

/**
 * Generate esm.sh URL for browser.
 * Uses ?external= so browser import map provides React (ensures single instance).
 * Uses ?target=es2022 for consistent builds.
 */
export function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string {
  const base = `https://esm.sh/${pkg}@${version}`;
  const params = [`target=es2022`];
  if (external?.length) {
    params.push(`external=${external.join(",")}`);
  }
  return `${base}?${params.join("&")}`;
}

/**
 * Get React esm.sh URLs with consistent versioning.
 * Used by both SSR and browser for full-stack consistency.
 * Uses ?target=es2022 to ensure identical builds (esm.sh auto-detects target otherwise).
 *
 * @param version - React version to use (defaults to REACT_VERSION)
 */
export function getReactUrls(version: string = REACT_VERSION) {
  return {
    react: `https://esm.sh/react@${version}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${version}?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${version}/client?target=es2022`,
    "react-dom/server": `https://esm.sh/react-dom@${version}/server?target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${version}/jsx-runtime?target=es2022`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${version}/jsx-dev-runtime?target=es2022`,
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
    "react/": `https://esm.sh/react@${version}/?target=es2022`,
  };
}

/**
 * Get Tailwind CSS import map entries.
 * Pins all tailwindcss imports to a unified version.
 * Uses ?target=es2022 for consistent builds.
 */
export function getTailwindImportMap(): Record<string, string> {
  const tw = TAILWIND_VERSION;
  // Note: We don't use "tailwindcss/" prefix entry because import map spec requires
  // URLs to end with "/" when keys end with "/", but query params prevent that.
  // Instead, we explicitly map all known subpaths.
  return {
    tailwindcss: `https://esm.sh/tailwindcss@${tw}?target=es2022`,
    "tailwindcss/plugin": `https://esm.sh/tailwindcss@${tw}/plugin?target=es2022`,
    "tailwindcss/colors": `https://esm.sh/tailwindcss@${tw}/colors?target=es2022`,
    "tailwindcss/defaultTheme": `https://esm.sh/tailwindcss@${tw}/defaultTheme?target=es2022`,
    "tailwindcss/lib/util/flattenColorPalette":
      `https://esm.sh/tailwindcss@${tw}/lib/util/flattenColorPalette?target=es2022`,
  };
}
