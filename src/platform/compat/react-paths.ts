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
import { satisfies, valid } from "npm:semver@7.8.5";
import { cwd } from "./process.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";

const ReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;

let localReactPathsCache: Readonly<Record<string, string>> | null = null;
const EMPTY_REACT_PATHS: Readonly<Record<string, string>> = Object.freeze({});

const REACT_SPECIFIERS = [
  "react",
  "react-dom",
  "react-dom/client",
  "react-dom/server",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
] as const;

/** Select a compatible installed version before emitting SSR and browser URLs. */
export function resolveInstalledReactRange(declaration: string): string | undefined {
  if (!isNode || valid(declaration)) return undefined;
  const version = createRequire(import.meta.url)("react/package.json").version;
  return satisfies(version, declaration) ? version : undefined;
}

function resolveReactSpecifier(specifier: string): string | undefined {
  // Resolve from the framework, never from an application or writable cache.
  // Node imports CJS through file URLs with its normal ESM interop.
  // Missing peers are fatal: falling back to a CDN could split React identity.
  if (isNode) return pathToFileURL(createRequire(import.meta.url).resolve(specifier)).href;
  try {
    if (isBun && typeof Bun?.resolveSync === "function") {
      const resolved = Bun.resolveSync(specifier, cwd());
      return pathToFileURL(resolved).href;
    }
  } catch (_) {
    /* expected: module resolution may fail in some runtimes */
  }

  return undefined;
}

export function getLocalReactPaths(): Readonly<Record<string, string>> {
  // Deno owns its HTTP import graph; Node/Bun use the framework's local peers.
  if (isDeno) return EMPTY_REACT_PATHS;
  if (localReactPathsCache) return localReactPathsCache;

  const paths: Record<string, string> = {};

  for (const specifier of REACT_SPECIFIERS) {
    const resolved = resolveReactSpecifier(specifier);
    if (resolved) paths[specifier] = resolved;
  }

  localReactPathsCache = Object.freeze(paths);
  return localReactPathsCache;
}

/** Resolve SSR React imports against the same peers as the framework renderer. */
export function getLocalReactPath(specifier: string, reactVersion?: string): string | undefined {
  if (!isReactSpecifier(specifier)) return undefined;
  if (isNode && reactVersion !== undefined) {
    const packageName =
      specifier === "react-dom" || ReflectApply(StringStartsWith, specifier, ["react-dom/"])
        ? "react-dom"
        : "react";
    const installedVersion = createRequire(import.meta.url)(`${packageName}/package.json`).version;
    if (!satisfies(installedVersion, reactVersion)) {
      throw new TypeError("Local React runtime does not match the selected project version");
    }
  }
  const mapped = getLocalReactPaths()[specifier];
  if (mapped) return mapped;
  // Unsupported or missing Node subpaths must fail through package exports.
  return isNode ? resolveReactSpecifier(specifier) : undefined;
}

export function isReactSpecifier(specifier: string): boolean {
  return (
    specifier === "react" ||
    specifier === "react-dom" ||
    ReflectApply(StringStartsWith, specifier, ["react/"]) ||
    ReflectApply(StringStartsWith, specifier, ["react-dom/"])
  );
}

export function clearReactPathsCache(): void {
  localReactPathsCache = null;
}
