/**
 * Central package version and URL registry.
 *
 * Single source of truth for all package versions used in both SSR and browser transforms.
 *
 * KEY INSIGHT: SSR uses npm: specifiers (Deno resolves these locally), while browser
 * uses esm.sh URLs. This ensures each environment has consistent module instances.
 * Context packages (react-query, etc) use React context and MUST be single instances.
 */

// Core framework versions
export const REACT_VERSION = "18.3.1";
export const TAILWIND_VERSION = "4.1.8";

/**
 * Context-dependent packages that require a single module instance.
 * These packages use React context and must be the SAME instance across SSR and browser.
 *
 * IMPORTANT: Both SSR and browser use esm.sh URLs to ensure identical module instances.
 * This prevents hydration errors caused by different module instances having different
 * React contexts (e.g., "No QueryClient set" error).
 *
 * The `external` field lists dependencies that should be provided by the import map,
 * ensuring all packages share the same React instance.
 */
export const CONTEXT_PACKAGES = {
  "@tanstack/react-query": { version: "5", external: ["react"] },
  "@tanstack/query-core": { version: "5", external: [] },
  "next-themes": { version: "0.4", external: ["react"] },
  "framer-motion": { version: "11", external: ["react"] },
  "react-hook-form": { version: "7", external: ["react", "react-dom"] },
} as const;

/** List of context package names for iteration */
export const CONTEXT_PACKAGE_NAMES = Object.keys(CONTEXT_PACKAGES) as Array<
  keyof typeof CONTEXT_PACKAGES
>;

/**
 * Generate npm: specifier for SSR (Deno).
 * @deprecated Use esm.sh URLs instead for consistent module instances across SSR and browser.
 */
export function getNpmSpecifier(pkg: string, version: string): string {
  return `npm:${pkg}@${version}`;
}

/**
 * Generate esm.sh URL for browser.
 * Uses ?external= so browser import map provides React (ensures single instance).
 * Uses ?target=es2022 for consistent builds.
 *
 * NOTE: ?external= works in browser (import map applies to HTTP modules),
 * but NOT in Deno SSR (import map doesn't apply to HTTP modules).
 * That's why SSR uses npm: specifiers instead.
 */
export function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string {
  const base = `https://esm.sh/${pkg}@${version}`;
  const params = [`target=es2022`];
  if (external?.length) {
    // Use ?external= so browser import map provides these dependencies
    // This ensures all packages use the same React from the import map
    params.push(`external=${external.join(",")}`);
  }
  return `${base}?${params.join("&")}`;
}

/**
 * Get URL for a context package - SSR version.
 * Uses esm.sh URLs (same as browser) to ensure identical module instances.
 * This prevents hydration errors from module instance mismatch.
 */
export function getContextPackageUrlSSR(pkg: keyof typeof CONTEXT_PACKAGES): string {
  const config = CONTEXT_PACKAGES[pkg];
  // Use esm.sh for SSR to match browser modules exactly
  return getEsmShUrl(pkg, config.version, config.external);
}

/**
 * Get URL for a context package - Browser version (esm.sh URL).
 */
export function getContextPackageUrlBrowser(pkg: keyof typeof CONTEXT_PACKAGES): string {
  const config = CONTEXT_PACKAGES[pkg];
  return getEsmShUrl(pkg, config.version, config.external);
}

/**
 * Get the unified esm.sh URL for a context-dependent package.
 * @deprecated Use getContextPackageUrlSSR or getContextPackageUrlBrowser instead
 */
export function getContextPackageUrl(pkg: keyof typeof CONTEXT_PACKAGES): string {
  // Default to browser URL for backwards compatibility
  return getContextPackageUrlBrowser(pkg);
}

/**
 * Check if a package name is a context-dependent package.
 */
export function isContextPackage(pkg: string): pkg is keyof typeof CONTEXT_PACKAGES {
  return pkg in CONTEXT_PACKAGES;
}

/**
 * Get React esm.sh URLs with consistent versioning.
 * Used by both SSR and browser for full-stack consistency.
 * Uses ?target=es2022 to ensure identical builds (esm.sh auto-detects target otherwise).
 */
export function getReactUrls() {
  return {
    react: `https://esm.sh/react@${REACT_VERSION}?target=es2022`,
    "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}?target=es2022`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client?target=es2022`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_VERSION}/server?target=es2022`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime?target=es2022`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime?target=es2022`,
  };
}

/**
 * Get complete React import map for esm.sh.
 * This is used by BOTH SSR and browser to ensure identical React instances,
 * preventing hydration mismatches.
 *
 * Works in Deno, Node, and Bun since esm.sh URLs are standard HTTPS imports.
 * Uses ?target=es2022 to ensure identical builds across all runtimes.
 */
export function getReactImportMap(): Record<string, string> {
  return {
    ...getReactUrls(),
    // Prefix match for any react/* subpath imports
    "react/": `https://esm.sh/react@${REACT_VERSION}/?target=es2022`,
  };
}

/**
 * Get the complete import map for context packages.
 * Returns a map of bare specifiers to esm.sh URLs.
 */
export function getContextPackageImportMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const pkg of CONTEXT_PACKAGE_NAMES) {
    map[pkg] = getContextPackageUrl(pkg);
  }
  return map;
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
