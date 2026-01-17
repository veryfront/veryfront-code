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
 * Get the absolute path to the veryfront Agent React module for SSR.
 * This resolves relative to this file's location in the veryfront source tree.
 */
function getVeryfrontAgentReactPath(): string {
  return `file://${getSrcDir()}/agent/react/index.ts`;
}

/**
 * Get the absolute path to the veryfront AI components module for SSR.
 */
function getVeryfrontComponentsPath(): string {
  return `file://${getSrcDir()}/react/components/ai/index.ts`;
}

/**
 * Get the absolute path to the veryfront primitives module for SSR.
 */
function getVeryfrontPrimitivesPath(): string {
  return `file://${getSrcDir()}/react/primitives/index.ts`;
}

/**
 * Resolve React imports based on target environment.
 *
 * Both SSR and Browser now use esm.sh URLs for React to ensure consistency.
 *
 * SSR: Transform React to esm.sh URLs. This is necessary because when SSR modules
 * are dynamically imported from file:// URLs, Deno's import map from deno.json
 * doesn't apply to the imported module's dependencies. Bare specifiers like "react"
 * fail because node_modules may not exist in Docker. Using esm.sh URLs ensures
 * Deno can fetch and cache React directly, regardless of node_modules.
 *
 * Browser: Transform to esm.sh URLs (via browser import map in HTML).
 *
 * Both environments use the same esm.sh URLs (e.g., https://esm.sh/react@18.3.1),
 * which ensures user code uses the same React instance as react-dom/server.
 * The deno.json import map also resolves react-dom/server to esm.sh with
 * external=react, so all code shares the same React instance from esm.sh.
 */
// deno-lint-ignore require-await
export async function resolveReactImports(code: string, forSSR: boolean = false): Promise<string> {
  // Get esm.sh URLs for React - same for both SSR and browser
  const reactImports = getReactImportMap();

  if (forSSR) {
    // SSR: Resolve React and veryfront module imports
    const ssrImports: Record<string, string> = {
      // React - use esm.sh URLs for dynamic file:// import compatibility
      ...reactImports,
      // Agent/Component modules - file:// URLs for local resolution (these don't have context issues)
      "veryfront/agent/react": getVeryfrontAgentReactPath(),
      "veryfront/components/ai": getVeryfrontComponentsPath(),
      "veryfront/primitives": getVeryfrontPrimitivesPath(),
      // Framework exports are NOT transformed here - they stay as bare specifiers
      // and get resolved by deno.json import map to ensure single module instance
    };

    return replaceSpecifiers(code, (specifier) => {
      return ssrImports[specifier] || null;
    });
  }

  // For browser, transform to esm.sh URLs
  return replaceSpecifiers(code, (specifier) => {
    return reactImports[specifier] || null;
  });
}

/**
 * Add deps/external params to esm.sh URLs for React version consistency.
 * esm.sh URLs that don't already have React version pinned get ?external added.
 *
 * IMPORTANT: We use `?external=react` (not `?external=react,react-dom`) to match
 * the configuration in deno.json for react-dom. esm.sh generates different URL
 * paths based on the externals list (e.g., X-ZXJlYWN0 vs X-ZXJlYWN0LHJlYWN0LWRvbQ),
 * and mismatched paths create separate React instances causing "Cannot read
 * properties of null (reading 'useState')" errors during SSR.
 */
export function addDepsToEsmShUrls(code: string, _forSSR: boolean = false): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (
      specifier.startsWith("https://esm.sh/") &&
      !specifier.includes(`react@${REACT_VERSION}`)
    ) {
      const hasQuery = specifier.includes("?");
      if (hasQuery) return null;
      return `${specifier}?external=react&target=es2022`;
    }
    return null;
  }));
}
