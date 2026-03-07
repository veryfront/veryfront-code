/**
 * Import Transformer
 *
 * Functions for rewriting and transforming import specifiers in MDX compiled code.
 * Handles project aliases, React paths, JSX transforms, and import map resolution.
 *
 * @module build/transforms/mdx/esm-module-loader/import-transformer
 */

import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
import { transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import type { ImportMapConfig } from "#veryfront/modules/import-map/index.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { replaceSpecifiers } from "../../esm/lexer.ts";
import { getLocalReactPaths, isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  FRAMEWORK_ROOT,
  JSX_IMPORT_PATTERN,
  LOG_PREFIX_MDX_LOADER,
  REACT_IMPORT_PATTERN,
} from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { hashString } from "./utils/hash.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";
import { ensureCachedJsxModulePatched } from "./jsx-cache.ts";
import type { ESMLoaderContext } from "./types.ts";

/**
 * Rewrite @/ aliased imports to /_vf_modules/ paths.
 */
export function rewriteProjectAliasImports(code: string): string {
  return code.replace(/from\s*["']@\/([^"']+)["']/g, (_match, path) => {
    const jsPath = path.endsWith(".js") ? path : `${path}.js`;
    return `from "/_vf_modules/${jsPath}"`;
  });
}

/**
 * Transform bare React specifiers to local file:// paths for Bun/Node.
 * This ensures the same React instance as react-dom-server.
 * For Deno, getLocalReactPaths() returns an empty object, so this is a no-op.
 */
export async function transformReactToLocalPaths(code: string): Promise<string> {
  const localPaths = getLocalReactPaths();
  if (Object.keys(localPaths).length === 0) return code;

  return await replaceSpecifiers(code, (specifier) => localPaths[specifier] || null);
}

function stripReactFromImportMap(importMap: ImportMapConfig): ImportMapConfig {
  const imports = importMap.imports ? { ...importMap.imports } : undefined;
  if (imports) {
    for (const key of Object.keys(imports)) {
      if (isReactSpecifier(key)) delete imports[key];
    }
  }

  const scopes = importMap.scopes
    ? Object.fromEntries(
      Object.entries(importMap.scopes).map(([scope, mappings]) => {
        const filtered = { ...mappings };
        for (const key of Object.keys(filtered)) {
          if (isReactSpecifier(key)) delete filtered[key];
        }
        return [scope, filtered];
      }),
    )
    : undefined;

  return { imports, scopes };
}

/**
 * Transform imports using project import maps.
 * React is intentionally left as a bare specifier for SSR consistency.
 */
export function transformImports(code: string, importMap: ImportMapConfig): string {
  return transformImportsWithMap(code, stripReactFromImportMap(importMap), undefined, {
    resolveBare: true,
  });
}

/**
 * Transform JSX/TSX imports using esbuild.
 * Optimized to process all imports in parallel batches for better performance.
 */
export async function transformJsxImports(
  code: string,
  adapter: ESMLoaderContext["adapter"],
  esmCacheDir: string,
): Promise<string> {
  const { transform } = await import("esbuild");

  const importsToProcess: Array<{
    fullMatch: string;
    importClause: string;
    filePath: string;
    ext: string;
  }> = [];

  let jsxMatch: RegExpExecArray | null;
  while ((jsxMatch = JSX_IMPORT_PATTERN.exec(code)) !== null) {
    const [fullMatch, importClause, filePath, ext] = jsxMatch;

    if (!filePath || !importClause || !ext) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Skipping JSX import with undefined fields`, {
        fullMatch,
        hasFilePath: !!filePath,
        hasImportClause: !!importClause,
        hasExt: !!ext,
      });
      continue;
    }

    importsToProcess.push({ fullMatch, importClause, filePath, ext });
  }

  if (importsToProcess.length === 0) return code;

  const transformStart = performance.now();
  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Transforming ${importsToProcess.length} JSX imports in parallel`,
  );

  const transformResults = await Promise.all(
    importsToProcess.map(async ({ fullMatch, importClause, filePath, ext }) => {
      try {
        const transformedFileName = `jsx-v${VERSION}-${hashString(filePath)}.mjs`;
        const transformedPath = join(esmCacheDir, transformedFileName);

        try {
          const stat = await getLocalFs().stat(transformedPath);
          if (stat?.isFile) {
            const useCached = await ensureCachedJsxModulePatched(transformedPath, filePath);
            if (useCached) {
              return {
                original: fullMatch,
                transformed: `import ${importClause} from "file://${transformedPath}";`,
                cached: true,
              };
            }
          }
        } catch {
          // Not cached
        }

        const isFrameworkFile = filePath.startsWith(FRAMEWORK_ROOT);
        let jsxCode: string | Uint8Array;
        if (isFrameworkFile) {
          jsxCode = await getLocalFs().readTextFile(filePath);
        } else if (adapter) {
          jsxCode = await adapter.fs.readFile(filePath);
        } else {
          logger.warn(
            `${LOG_PREFIX_MDX_LOADER} No adapter available to read JSX file: ${filePath}`,
          );
          return null;
        }

        const loaderMap: Record<string, "js" | "jsx" | "ts" | "tsx"> = {
          tsx: "tsx",
          ts: "ts",
          jsx: "jsx",
          js: "js",
        };
        const loader = loaderMap[ext] ?? "tsx";

        const result = await transform(jsxCode as string, {
          loader,
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });

        let transformed = result.code;
        if (!REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }

        // Rewrite _dnt.polyfills.js / _dnt.shims.js relative imports to absolute file:// paths.
        // Framework files from the npm package contain relative dnt imports that resolve
        // incorrectly when cached to a different directory.
        transformed = rewriteDntImports(transformed, filePath);

        await getLocalFs().writeTextFile(transformedPath, transformed);

        return {
          original: fullMatch,
          transformed: `import ${importClause} from "file://${transformedPath}";`,
          cached: false,
        };
      } catch (error) {
        logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform JSX import: ${filePath}`, error);
        return null;
      }
    }),
  );

  logger.debug(`${LOG_PREFIX_MDX_LOADER} JSX transform phase completed`, {
    total: importsToProcess.length,
    success: transformResults.filter(Boolean).length,
    cached: transformResults.filter((r) => r?.cached).length,
    durationMs: (performance.now() - transformStart).toFixed(1),
  });

  let result = code;
  for (const t of transformResults) {
    if (t) result = result.replace(t.original, t.transformed);
  }

  return result;
}
