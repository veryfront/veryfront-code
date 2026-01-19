/**
 * Cross-runtime React path resolution.
 *
 * Provides consistent React module resolution for Bun/Node SSR.
 * This ensures the same React instance is used by both user components
 * and react-dom-server, preventing "Objects are not valid as a React child"
 * or "Cannot read properties of null (reading 'useState')" errors.
 *
 * @module
 */

import { pathToFileURL } from "node:url";
import { isBun, isDeno, isNode } from "./runtime.ts";
import { cwd } from "./process.ts";

/**
 * Cache for resolved local React paths.
 */
let localReactPathsCache: Record<string, string> | null = null;

/**
 * Standard React specifiers that need resolution for SSR.
 */
const REACT_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

/**
 * Check if Bun.resolveSync is available.
 */
function hasBunResolveSync(): boolean {
  // deno-lint-ignore no-explicit-any
  return typeof Bun !== "undefined" && typeof (Bun as any).resolveSync === "function";
}

type ImportMetaWithResolve = ImportMeta & {
  resolve?: (specifier: string, parent?: string) => string;
};

const IMPORT_META_RESOLVE_ERROR = "ImportMetaResolveUnavailable";

function rethrowIfImportMetaResolveMissing(error: unknown): void {
  if (error instanceof Error && error.name === IMPORT_META_RESOLVE_ERROR) {
    throw error;
  }
}

function resolveWithImportMeta(specifier: string, parentUrl: string): string | null {
  const metaResolve = (import.meta as ImportMetaWithResolve).resolve;
  if (typeof metaResolve !== "function") {
    const error = new Error(
      "import.meta.resolve is required for Node ESM resolution (Node >= 22).",
    );
    error.name = IMPORT_META_RESOLVE_ERROR;
    throw error;
  }
  try {
    return metaResolve(specifier, parentUrl);
  } catch {
    return null;
  }
}

/**
 * Resolve a single React specifier to an absolute file path.
 * Returns undefined if resolution fails.
 */
function resolveReactSpecifier(specifier: string): string | undefined {
  try {
    if (isBun && hasBunResolveSync()) {
      // deno-lint-ignore no-explicit-any
      const resolved = (Bun as any).resolveSync(specifier, cwd());
      return `file://${resolved}`;
    }
    if (isNode) {
      const parentUrl = pathToFileURL(cwd() + "/").href;
      const resolved = resolveWithImportMeta(specifier, parentUrl);
      if (resolved) return resolved;
    }
  } catch (error) {
    rethrowIfImportMetaResolveMissing(error);
    // Module not found
  }
  return undefined;
}

/**
 * Get local React import map for Bun/Node SSR.
 *
 * Returns absolute file:// paths to node_modules React packages.
 * This ensures the same React instance as react-dom-server and allows
 * modules to be imported from temp directories.
 *
 * In Deno, returns an empty object since Deno handles bare specifiers
 * via import maps.
 *
 * @returns Record mapping React specifiers to file:// URLs
 *
 * @example
 * ```ts
 * const paths = getLocalReactPaths();
 * // {
 * //   "react": "file:///path/to/node_modules/react/index.js",
 * //   "react-dom": "file:///path/to/node_modules/react-dom/index.js",
 * //   ...
 * // }
 * ```
 */
export function getLocalReactPaths(): Record<string, string> {
  // Deno handles React via import maps
  if (isDeno) {
    return {};
  }

  // Return cached paths if available
  if (localReactPathsCache) {
    return localReactPathsCache;
  }

  const paths: Record<string, string> = {};

  for (const specifier of REACT_SPECIFIERS) {
    const resolved = resolveReactSpecifier(specifier);
    if (resolved) {
      paths[specifier] = resolved;
    }
  }

  localReactPathsCache = paths;
  return paths;
}

/**
 * Check if a specifier is a React package.
 */
export function isReactSpecifier(specifier: string): boolean {
  return (
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier.startsWith("react/") ||
    specifier.startsWith("react-dom/")
  );
}

/**
 * Clear the cached React paths.
 * Useful for testing or when node_modules changes.
 */
export function clearReactPathsCache(): void {
  localReactPathsCache = null;
}
