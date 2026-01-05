/**
 * Central package version and URL registry.
 *
 * Single source of truth for all package versions used in both SSR and browser transforms.
 * This ensures SSR and browser resolve context-dependent packages to identical module instances,
 * preventing React context mismatch issues (e.g., "No QueryClient set" error).
 */

// Core framework versions
export const REACT_VERSION = "18.3.1";
export const TAILWIND_VERSION = "4.1.8";

/**
 * Context-dependent packages that require a single module instance.
 * These packages use React context and must be the SAME instance in SSR and browser,
 * otherwise hydration will fail with context not found errors.
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
 * Generate a consistent esm.sh URL for a package.
 * @param pkg Package name (e.g., "@tanstack/react-query")
 * @param version Version string (e.g., "5")
 * @param external Optional list of packages to externalize (uses ?external= param)
 */
export function getEsmShUrl(pkg: string, version: string, external?: readonly string[]): string {
  const base = `https://esm.sh/${pkg}@${version}`;
  return external?.length ? `${base}?external=${external.join(",")}` : base;
}

/**
 * Get the unified esm.sh URL for a context-dependent package.
 * Used by both SSR and browser transforms to ensure identical module resolution.
 */
export function getContextPackageUrl(pkg: keyof typeof CONTEXT_PACKAGES): string {
  const config = CONTEXT_PACKAGES[pkg];
  return getEsmShUrl(pkg, config.version, config.external);
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
 */
export function getReactUrls() {
  return {
    react: `https://esm.sh/react@${REACT_VERSION}`,
    "react-dom": `https://esm.sh/react-dom@${REACT_VERSION}`,
    "react-dom/client": `https://esm.sh/react-dom@${REACT_VERSION}/client`,
    "react-dom/server": `https://esm.sh/react-dom@${REACT_VERSION}/server`,
    "react/jsx-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-runtime`,
    "react/jsx-dev-runtime": `https://esm.sh/react@${REACT_VERSION}/jsx-dev-runtime`,
  };
}

/**
 * Get complete React import map for esm.sh.
 * This is used by BOTH SSR and browser to ensure identical React instances,
 * preventing hydration mismatches.
 *
 * Works in Deno, Node, and Bun since esm.sh URLs are standard HTTPS imports.
 */
export function getReactImportMap(): Record<string, string> {
  return {
    ...getReactUrls(),
    // Prefix match for any react/* subpath imports
    "react/": `https://esm.sh/react@${REACT_VERSION}/`,
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
 */
export function getTailwindImportMap(): Record<string, string> {
  const tw = TAILWIND_VERSION;
  return {
    tailwindcss: `https://esm.sh/tailwindcss@${tw}`,
    "tailwindcss/": `https://esm.sh/tailwindcss@${tw}/`,
    "tailwindcss/plugin": `https://esm.sh/tailwindcss@${tw}/plugin`,
    "tailwindcss/colors": `https://esm.sh/tailwindcss@${tw}/colors`,
    "tailwindcss/defaultTheme": `https://esm.sh/tailwindcss@${tw}/defaultTheme`,
    "tailwindcss/lib/util/flattenColorPalette":
      `https://esm.sh/tailwindcss@${tw}/lib/util/flattenColorPalette`,
  };
}
