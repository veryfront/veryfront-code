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
 * v4: Add external=react to react-dom URLs to prevent dual React instances
 * v5: Don't rewrite React imports - let import map resolve to shared modules
 * v6: SSR on Deno keeps React as bare specifiers for import map resolution
 * v7: http-cache.ts keeps React bare specifiers for import map resolution
 * v8: http-cache.ts resolves React bare specifiers to esm.sh URLs (file:// modules don't use import maps)
 * v9: jsx-runtime uses external=react to share single React instance with third-party packages
 * v10: html/utils.ts and http-cache.ts fallbacks use external=react for all React sub-packages
 * v11: Fix normalizeEsmShUrl to only skip external for base react@version, not subpaths
 * v12: Fix cdn.ts duplicate getReactImportMap to use external=react on all React sub-packages
 * v13: Fix resolver.ts to insert subpath BEFORE query params in esm.sh URLs
 * v14: Include TRANSFORM_CACHE_VERSION in pipeline transform cache key
 * v15: Add React to default import map for remote projects without deno.json
 * v16: Debug logging for React jsx-runtime resolution
 * v17: Fix shouldResolve to skip esm.sh URLs with query params (already processed)
 * v18: Revert to external=react only - external=react,react-dom breaks react-dom internals
 * v19: Add deps=react@X,react-dom@X to pin versions and prevent ReactCurrentBatchConfig errors
 * v20: Default import map for Deno SSR uses shared-*.ts files for single React instance
 * v21: Force React to shared-*.ts in loader.ts normalizeImportMapForRuntime for Deno
 * v22: Add esm.sh scope to import map so third-party packages resolve react to shared-*.ts
 * v23: http-cache.ts resolveBareSpecifier uses shared-*.ts for React in Deno SSR
 * v24: Enable ssr-http-cache stage for Deno to cache esm.sh modules and rewrite React imports
 * v25: Remove debug logging
 */
export const TRANSFORM_CACHE_VERSION = 25;

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
  // All React sub-packages must use external=react to share the same React instance.
  // This ensures jsx-runtime, react-dom, and third-party packages all use one React.
  // Without this, esm.sh bundles React into each sub-package separately.
  // Note: We can't use external=react,react-dom because it breaks react-dom's internal imports.
  return {
    react: `https://esm.sh/react@${version}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${version}?external=react&target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${version}/client?external=react&target=es2022`,
    "react-dom/server": `https://esm.sh/react-dom@${version}/server?external=react&target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${version}/jsx-runtime?external=react&target=es2022`,
    "react/jsx-dev-runtime":
      `https://esm.sh/react@${version}/jsx-dev-runtime?external=react&target=es2022`,
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
    "react/": `https://esm.sh/react@${version}/?external=react&target=es2022`,
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
