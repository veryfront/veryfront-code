/**
 * Specifier resolution helpers for the SSR VF Modules stage.
 *
 * @module transforms/pipeline/stages/ssr-vf-modules/specifier-resolver
 */

import { join } from "#veryfront/compat/path/index.ts";
import { buildReactUrl, getReactImportMap } from "../../../import-rewriter/url-builder.ts";
import { FRAMEWORK_ROOT } from "./constants.ts";

export interface FrameworkSpecifierResolverInput {
  denoConfigStubUrl: string | null;
  veryfrontReplacements: ReadonlyMap<string, string>;
  relativeReplacements: ReadonlyMap<string, string>;
  reactVersion: string;
  reactImportMap?: Record<string, string>;
}

/**
 * Resolve a bare `react` / `react-dom` (or subpath) specifier to its esm.sh
 * URL for the given React version. Returns `null` for anything that is not a
 * React specifier.
 */
export function resolveReactSpecifier(
  specifier: string,
  reactVersion: string,
  reactImportMap: Record<string, string> = getReactImportMap(reactVersion),
): string | null {
  const mapped = reactImportMap[specifier];
  if (mapped) return mapped;
  if (specifier.startsWith("react/")) {
    return buildReactUrl("react", reactVersion, "/" + specifier.slice("react/".length), true);
  }
  if (specifier.startsWith("react-dom/")) {
    return buildReactUrl(
      "react-dom",
      reactVersion,
      "/" + specifier.slice("react-dom/".length),
      true,
    );
  }
  return null;
}

/**
 * veryfront's own React re-export modules under `FRAMEWORK_ROOT/react/`
 * mapped to the bare specifier they stand in for.
 */
const REACT_REEXPORT_SPECIFIERS: Record<string, string> = {
  "react.js": "react",
  "react-dom.js": "react-dom",
  "react-dom-client.js": "react-dom/client",
  "react-dom-server.js": "react-dom/server",
  "jsx-runtime.js": "react/jsx-runtime",
  "jsx-dev-runtime.js": "react/jsx-dev-runtime",
};

/** `FRAMEWORK_ROOT/react/` prefix, precomputed (invariant per process). */
const REACT_REEXPORT_DIR = join(FRAMEWORK_ROOT, "react") + "/";

/**
 * If `resolvedPath` is one of veryfront's React re-export modules
 * (`FRAMEWORK_ROOT/react/*.js`), return the esm.sh URL it should be rewritten
 * to for the given React version. Returns `null` for anything else.
 */
export function reactReExportToEsmUrl(
  resolvedPath: string,
  reactVersion: string,
  reactImportMap?: Record<string, string>,
): string | null {
  if (!resolvedPath.startsWith(REACT_REEXPORT_DIR)) return null;
  const specifier = REACT_REEXPORT_SPECIFIERS[resolvedPath.slice(REACT_REEXPORT_DIR.length)];
  if (!specifier) return null;
  return resolveReactSpecifier(specifier, reactVersion, reactImportMap);
}

/**
 * Build the final specifier resolver for transformed framework code.
 */
export function createFrameworkSpecifierResolver(
  input: FrameworkSpecifierResolverInput,
): (specifier: string) => string | null {
  const reactImportMap = input.reactImportMap ?? getReactImportMap(input.reactVersion);

  return (specifier: string): string | null => {
    if (specifier === "#deno-config") {
      return input.denoConfigStubUrl;
    }

    if (specifier.startsWith("#veryfront/")) {
      return input.veryfrontReplacements.get(specifier) ?? null;
    }

    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      return input.relativeReplacements.get(specifier) ?? null;
    }

    return resolveReactSpecifier(specifier, input.reactVersion, reactImportMap);
  };
}
