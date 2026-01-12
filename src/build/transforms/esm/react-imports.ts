import { replaceSpecifiers } from "./lexer.ts";
import { getReactImportMap, REACT_VERSION } from "./package-registry.ts";

/**
 * Get the src directory path for resolving veryfront modules.
 */
function getSrcDir(): string {
  const currentDir = new URL(".", import.meta.url).pathname;
  return currentDir.replace(/\/build\/transforms\/esm\/?$/, "");
}

/**
 * Get the absolute path to the veryfront AI React module for SSR.
 * This resolves relative to this file's location in the veryfront source tree.
 */
function getVeryfrontAIReactPath(subpath: string = ""): string {
  const modulePath = subpath || "index.ts";
  return `file://${getSrcDir()}/ai/react/${modulePath}`;
}

/**
 * Get the absolute path to a veryfront export module for SSR.
 * Exports are located at: src/exports/{name}.ts
 */
function getVeryfrontExportPath(name: string): string {
  return `file://${getSrcDir()}/exports/${name}.ts`;
}

/**
 * Resolve React imports based on target environment.
 *
 * SSR: Leave React as bare specifiers so Deno's import map (deno.json) resolves
 * them to npm: packages. This ensures user code uses the same React instance
 * as react-dom/server (which is from npm).
 *
 * Browser: Transform to esm.sh URLs (via browser import map in HTML).
 *
 * This separation is necessary because react-dom/server from npm has its own
 * internal dependency on npm:react. Using esm.sh/react for user code while
 * react-dom/server uses npm:react creates a React instance mismatch.
 */
// deno-lint-ignore require-await
export async function resolveReactImports(code: string, forSSR: boolean = false): Promise<string> {
  if (forSSR) {
    // SSR: Only resolve veryfront AI imports to file:// URLs
    // Framework exports (veryfront/head, veryfront/router, etc.) are left as bare specifiers
    // so they get resolved by deno.json import map - this ensures the same module instance
    // is used by both framework code and user code (avoiding React context mismatch issues)
    const ssrImports: Record<string, string> = {
      // AI modules - file:// URLs for local resolution (these don't have context issues)
      "veryfront/ai/react": getVeryfrontAIReactPath(),
      "veryfront/ai/components": getVeryfrontAIReactPath("components/index.ts"),
      "veryfront/ai/primitives": getVeryfrontAIReactPath("primitives/index.ts"),
      // Framework exports are NOT transformed here - they stay as bare specifiers
      // and get resolved by deno.json import map to ensure single module instance
    };

    return replaceSpecifiers(code, (specifier) => {
      return ssrImports[specifier] || null;
    });
  }

  // For browser, transform to esm.sh URLs
  const reactImports = getReactImportMap();
  return replaceSpecifiers(code, (specifier) => {
    return reactImports[specifier] || null;
  });
}

/**
 * Packages that are in the import map and should be converted to bare specifiers.
 * This ensures the import map can intercept and provide consistent modules.
 */
const IMPORT_MAP_PACKAGES = [
  "@tanstack/react-query",
  "@tanstack/query-core",
  "next-themes",
  "framer-motion",
  "react-hook-form",
];

/**
 * Extract package name from esm.sh URL.
 * E.g., "https://esm.sh/@tanstack/react-query@5?external=react" -> "@tanstack/react-query"
 */
function extractPackageFromEsmSh(url: string): string | null {
  if (!url.startsWith("https://esm.sh/") && !url.startsWith("http://esm.sh/")) {
    return null;
  }

  // Remove protocol and host
  let path = url.replace(/^https?:\/\/esm\.sh\//, "");

  // Remove version prefix like /v135/
  path = path.replace(/^v\d+\//, "");

  // Handle scoped packages like @tanstack/react-query@5?external=...
  if (path.startsWith("@")) {
    const match = path.match(/^(@[^/]+\/[^@/?]+)/);
    return match?.[1] ?? null;
  } else {
    // Regular package: name@version or name?query
    const match = path.match(/^([^@/?]+)/);
    return match?.[1] ?? null;
  }
}

/**
 * Add deps/external params to esm.sh URLs for React version consistency.
 *
 * UNIFIED APPROACH: Both SSR and browser use the same strategy now.
 * esm.sh URLs that don't already have React version pinned get ?deps added.
 */
export function addDepsToEsmShUrls(code: string, _forSSR: boolean = false): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (
      specifier.startsWith("https://esm.sh/") &&
      !specifier.includes(`react@${REACT_VERSION}`)
    ) {
      // Convert import-mapped packages to bare specifiers
      // This allows the import map to intercept and provide consistent modules
      const packageName = extractPackageFromEsmSh(specifier);
      if (packageName && IMPORT_MAP_PACKAGES.includes(packageName)) {
        return packageName; // Return bare specifier for import map to handle
      }

      // For other esm.sh URLs, add external param if not present
      // Using ?external= so esm.sh doesn't bundle React - browser import map provides it
      const hasQuery = specifier.includes("?");
      if (hasQuery) {
        return null; // Already has query params
      }
      return `${specifier}?external=react,react-dom&target=es2022`;
    }
    return null;
  }));
}
