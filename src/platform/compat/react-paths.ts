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
import { cwd } from "./process.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";

const EMPTY_REACT_PATHS: Record<string, string> = Object.freeze({});
let localReactPathsCache: Record<string, string> | null = null;

const REACT_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

function resolveReactSpecifier(specifier: string): string | undefined {
  try {
    if (!isBun) return undefined;
    const bun = Reflect.get(globalThis, "Bun") as
      | { resolveSync?: (specifier: string, dir: string) => string }
      | undefined;
    if (typeof bun?.resolveSync !== "function") return undefined;
    return pathToFileURL(bun.resolveSync(specifier, cwd())).href;
  } catch {
    /* expected: module resolution may fail in some runtimes */
  }

  return undefined;
}

export function getLocalReactPaths(): Record<string, string> {
  // On Deno, return empty - use esm.sh URLs instead (handled elsewhere).
  // On Node.js, return empty - keep React as bare specifiers and let Node.js
  // handle CJS/ESM interop naturally. Using file:// URLs for React's CJS
  // modules doesn't work because Node.js can't import CJS via file:// in ESM.
  // Bun handles this correctly, so we only resolve paths for Bun.
  if (isDeno || isNode) return EMPTY_REACT_PATHS;
  if (localReactPathsCache) return localReactPathsCache;

  const paths: Record<string, string> = {};

  for (const specifier of REACT_SPECIFIERS) {
    const resolved = resolveReactSpecifier(specifier);
    if (resolved) paths[specifier] = resolved;
  }

  localReactPathsCache = Object.freeze(paths);
  return paths;
}

export function isReactSpecifier(specifier: string): boolean {
  return (
    specifier === "react" ||
    specifier === "react-dom" ||
    specifier.startsWith("react/") ||
    specifier.startsWith("react-dom/")
  );
}

export function clearReactPathsCache(): void {
  localReactPathsCache = null;
}
