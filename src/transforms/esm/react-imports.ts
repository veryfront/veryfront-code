import { replaceSpecifiers } from "./lexer.ts";
import { getReactImportMap, REACT_VERSION } from "./package-registry.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";

/**
 * Get the src directory path for resolving veryfront modules.
 * Cached to avoid repeated URL parsing.
 */
const srcDir = new URL(".", import.meta.url).pathname.replace(/\/build\/transforms\/esm\/?$/, "");

/**
 * Get absolute file:// paths for veryfront SSR modules.
 */
function getVeryfrontModulePaths(): Record<string, string> {
  return {
    "veryfront/agent/react": `file://${srcDir}/agent/react/index.ts`,
    "veryfront/components/ai": `file://${srcDir}/react/components/ai/index.ts`,
    "veryfront/primitives": `file://${srcDir}/react/primitives/index.ts`,
  };
}

/**
 * Resolve React imports based on target environment.
 *
 * SSR in Deno: Transform React to esm.sh URLs which are later cached to file://
 * during the SSR HTTP cache stage for runtime-agnostic loading.
 *
 * SSR in Bun/Node: Keep React as local file:// paths to node_modules,
 * ensuring the same React instance is used by both user components and react-dom-server.
 * This prevents "Objects are not valid as a React child" errors from mismatched instances.
 *
 * Browser: Transform to esm.sh URLs (via browser import map in HTML).
 *
 * @param code - Source code to transform
 * @param forSSR - Whether this is for SSR (true) or browser (false)
 * @param reactVersion - React version to use (defaults to REACT_VERSION)
 */
// deno-lint-ignore require-await
export async function resolveReactImports(
  code: string,
  forSSR: boolean = false,
  reactVersion: string = REACT_VERSION,
): Promise<string> {
  if (!forSSR) {
    // Browser: Transform to esm.sh URLs
    const reactImports = getReactImportMap(reactVersion);
    return replaceSpecifiers(code, (specifier) => reactImports[specifier] || null);
  }

  // SSR: Resolve veryfront module imports + React paths
  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...(isDeno ? getReactImportMap(reactVersion) : getLocalReactPaths()),
  };

  return replaceSpecifiers(code, (specifier) => ssrImports[specifier] || null);
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
 *
 * @param code - Source code to transform
 * @param _forSSR - Whether this is for SSR (unused but kept for API compatibility)
 * @param reactVersion - React version to check against (defaults to REACT_VERSION)
 */
export function addDepsToEsmShUrls(
  code: string,
  _forSSR: boolean = false,
  reactVersion: string = REACT_VERSION,
): Promise<string> {
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (
      specifier.startsWith("https://esm.sh/") &&
      !specifier.includes(`react@${reactVersion}`)
    ) {
      const hasQuery = specifier.includes("?");
      if (hasQuery) return null;
      return `${specifier}?external=react&target=es2022`;
    }
    return null;
  }));
}
