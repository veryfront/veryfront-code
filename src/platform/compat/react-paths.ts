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

type ImportMetaWithResolve = ImportMeta & {
  resolve?: (specifier: string, parent?: string) => string;
};

const IMPORT_META_RESOLVE_ERROR = "ImportMetaResolveUnavailable";

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

function resolveReactSpecifier(specifier: string): string | undefined {
  try {
    if (isBun && hasBunResolveSync() && Bun?.resolveSync) {
      const resolved = Bun.resolveSync(specifier, cwd());
      return `file://${resolved}`;
    }

    if (isNode) {
      const parentUrl = pathToFileURL(`${cwd()}/`).href;
      return resolveWithImportMeta(specifier, parentUrl) ?? undefined;
    }
  } catch (error) {
    if (error instanceof Error && error.name === IMPORT_META_RESOLVE_ERROR) {
      throw error;
    }
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
