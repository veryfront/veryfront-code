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

// Bun global type declaration for cross-runtime compatibility
declare const Bun: { resolveSync?: (specifier: string, dir: string) => string } | undefined;

import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { isBun, isDeno, isNode } from "./runtime.ts";
import { cwd } from "./process.ts";

let localReactPathsCache: Record<string, string> | null = null;

const REACT_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

function hasBunResolveSync(): boolean {
  return typeof Bun !== "undefined" && typeof Bun?.resolveSync === "function";
}

function resolveReactSpecifier(specifier: string): string | undefined {
  try {
    if (isBun && hasBunResolveSync() && Bun?.resolveSync) {
      const resolved = Bun.resolveSync(specifier, cwd());
      return `file://${resolved}`;
    }

    if (isNode) {
      // Use createRequire to resolve React from veryfront's node_modules.
      // import.meta.resolve's parentUrl argument doesn't work correctly in Node.js,
      // so we use createRequire which properly resolves from the specified path.
      const require = createRequire(import.meta.url);
      const resolved = require.resolve(specifier);
      return pathToFileURL(resolved).href;
    }
  } catch {
    // Resolution failed, return undefined
  }

  return undefined;
}

export function getLocalReactPaths(): Record<string, string> {
  if (isDeno) return {};
  if (localReactPathsCache) return localReactPathsCache;

  const paths: Record<string, string> = {};

  for (const specifier of REACT_SPECIFIERS) {
    const resolved = resolveReactSpecifier(specifier);
    if (resolved) paths[specifier] = resolved;
  }

  localReactPathsCache = paths;
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
