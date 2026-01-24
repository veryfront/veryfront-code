import { replaceSpecifiers } from "./lexer.ts";
import { getReactImportMap, REACT_VERSION } from "./package-registry.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getLocalReactPaths } from "#veryfront/platform/compat/react-paths.ts";

/**
 * Get the src directory path for resolving veryfront modules.
 * Cached to avoid repeated URL parsing.
 */
const srcDir = new URL(".", import.meta.url).pathname.replace(
  /\/(build|src)\/transforms\/esm\/?$/,
  "",
);

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
 * SSR in Deno: Keep React as bare specifiers so Deno's import map resolves them
 * to shared-react.ts, ensuring a single React instance across all modules.
 * Third-party packages use external=react,react-dom which also resolve via import map.
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

  // SSR in Deno: Keep React as bare specifiers (resolved by import map to shared-react.ts)
  // SSR in Node/Bun: Transform to local file:// paths to node_modules
  // Only resolve veryfront modules for both
  const ssrImports: Record<string, string> = {
    ...getVeryfrontModulePaths(),
    ...(isDeno ? {} : getLocalReactPaths()), // Deno: bare specifiers; Node/Bun: local paths
  };

  return replaceSpecifiers(code, (specifier) => ssrImports[specifier] || null);
}

/**
 * Add deps/external params to esm.sh URLs for React version consistency.
 * esm.sh URLs that don't already have React version pinned get params added.
 *
 * Uses two esm.sh features:
 * - `external=react` - Don't bundle React, let import map resolve it
 * - `deps=react@X,react-dom@X` - Pin dependency versions to prevent mismatches
 *
 * The `deps` param is critical because third-party packages often have loose
 * version ranges like `react-dom@^18.3.1` which esm.sh would resolve to 18.x,
 * causing "ReactCurrentBatchConfig" errors when mixed with React 19.
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
  // Pin both react and react-dom to our version to prevent version mismatches
  const deps = `deps=react@${reactVersion},react-dom@${reactVersion}`;
  return Promise.resolve(replaceSpecifiers(code, (specifier) => {
    if (
      specifier.startsWith("https://esm.sh/") &&
      !specifier.includes(`react@${reactVersion}`)
    ) {
      const hasQuery = specifier.includes("?");
      if (hasQuery) return null;
      return `${specifier}?${deps}&external=react&target=es2022`;
    }
    return null;
  }));
}
