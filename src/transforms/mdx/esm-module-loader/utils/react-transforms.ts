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
import { IS_TRUE_NODE } from "../constants.ts";

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

  const replacements: Array<[RegExp, string | null]> = [
    [/from\s*['"]react\/jsx-runtime['"]/g, await resolveNodePackage("react/jsx-runtime")],
    [
      /from\s*['"]react\/jsx-dev-runtime['"]/g,
      await resolveNodePackage("react/jsx-dev-runtime"),
    ],
    [/from\s*['"]react-dom['"]/g, await resolveNodePackage("react-dom")],
    [/from\s*['"]react['"]/g, await resolveNodePackage("react")],
  ];

  let result = code;

  for (const [pattern, resolvedPath] of replacements) {
    if (!resolvedPath) continue;
    result = result.replace(pattern, `from "file://${resolvedPath}"`);
  }

  return result;
}
