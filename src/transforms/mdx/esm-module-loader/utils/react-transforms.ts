/**
 * React Import Transforms
 *
 * Transforms React imports to absolute file:// paths for Node.js.
 * Required because MDX modules are cached in arbitrary directories
 * (like temp dirs) where Node.js cannot resolve bare 'react' imports.
 *
 * @module build/transforms/mdx/esm-module-loader/utils/react-transforms
 */

import { fileURLToPath } from "node:url";
import { NOT_SUPPORTED } from "#veryfront/errors";
import { IS_TRUE_NODE } from "../constants.ts";
import { replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";

type ImportMetaWithResolve = ImportMeta & {
  resolve?: (specifier: string, parent?: string) => string;
};

const IMPORT_META_RESOLVE_ERROR = "ImportMetaResolveUnavailable";

function resolveWithImportMeta(specifier: string, parentUrl: string): string | null {
  const metaResolve = (import.meta as ImportMetaWithResolve).resolve;

  if (typeof metaResolve !== "function") {
    const error = NOT_SUPPORTED.create({
      detail: "import.meta.resolve is required for Node ESM resolution (Node >= 22).",
    });
    error.name = IMPORT_META_RESOLVE_ERROR;
    throw error;
  }

  try {
    return metaResolve(specifier, parentUrl);
  } catch (_) {
    /* expected: specifier may not be resolvable in this environment */
    return null;
  }
}

const resolvedPaths: Record<string, string | null> = {};

export function resolveNodePackage(packageSpec: string): string | null {
  if (!IS_TRUE_NODE) return null;

  const cached = resolvedPaths[packageSpec];
  if (cached !== undefined) return cached;

  try {
    const resolvedUrl = resolveWithImportMeta(packageSpec, import.meta.url);
    if (!resolvedUrl) {
      resolvedPaths[packageSpec] = null;
      return null;
    }

    const resolvedPath = fileURLToPath(resolvedUrl);
    resolvedPaths[packageSpec] = resolvedPath;
    return resolvedPath;
  } catch (error) {
    if (error instanceof Error && error.name === IMPORT_META_RESOLVE_ERROR) throw error;
    resolvedPaths[packageSpec] = null;
    return null;
  }
}

export async function transformReactImportsToAbsolute(code: string): Promise<string> {
  if (!IS_TRUE_NODE) return code;

  // Resolve all React package paths up front so the replacer is synchronous.
  const reactPaths: Record<string, string | null> = {
    "react/jsx-runtime": await resolveNodePackage("react/jsx-runtime"),
    "react/jsx-dev-runtime": await resolveNodePackage("react/jsx-dev-runtime"),
    "react-dom": await resolveNodePackage("react-dom"),
    "react": await resolveNodePackage("react"),
  };

  // Use the AST-aware lexer rather than a blanket regex so that only actual
  // import specifiers are rewritten.  A string literal like
  // `"import React from 'react'"` in a code comment or template would NOT be
  // touched by replaceSpecifiers, unlike a plain `.replace(/from 'react'/g,…)`.
  return replaceSpecifiers(code, (specifier) => {
    const resolved = reactPaths[specifier];
    return resolved ? `file://${resolved}` : null;
  });
}
