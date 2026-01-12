/**
 * Project Alias Import Transformation
 *
 * Transforms @/ aliased imports to file:// paths.
 * @/ is a project-relative alias that maps to the project root.
 *
 * @module build/transforms/mdx/esm-loader/import-rewriter/project-alias
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  LOG_PREFIX_MDX_LOADER,
  PROJECT_ALIAS_IMPORT_PATTERN,
  REACT_IMPORT_PATTERN,
} from "../constants.ts";
import { hashString } from "../cache/keys.ts";

interface FSAdapter {
  readFile(path: string): Promise<string | Uint8Array>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
  stat(path: string): Promise<{ isFile?: boolean } | null>;
  makeTempDir(prefix: string): Promise<string>;
}

/**
 * Transform @/ aliased imports to file:// paths.
 * Reads and transforms the source files, caching the results.
 *
 * @param code - Source code containing @/ imports
 * @param fs - Filesystem adapter for reading files
 * @param esmCacheDir - Directory to cache transformed files
 */
export async function transformProjectAliasImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports: Array<{
    original: string;
    importClause: string;
    relativePath: string;
  }> = [];

  // Find all @/ imports
  let match;
  const pattern = new RegExp(PROJECT_ALIAS_IMPORT_PATTERN.source, "g");
  while ((match = pattern.exec(code)) !== null) {
    const [original, importClause, relativePath] = match;
    if (relativePath && importClause) {
      imports.push({ original, importClause, relativePath });
    }
  }

  if (imports.length === 0) {
    return code;
  }

  logger.info(`${LOG_PREFIX_MDX_LOADER} Found ${imports.length} @/ imports to transform`);

  const { transform } = await import("esbuild/mod.js");
  let result = code;

  for (const { original, importClause, relativePath } of imports) {
    // Try common extensions
    const extensions = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx"];
    let fileContent: string | null = null;
    let resolvedPath: string | null = null;
    let ext: string = "";

    for (const tryExt of extensions) {
      const tryPath = relativePath + tryExt;
      try {
        const content = await fs.readFile(tryPath);
        fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
        resolvedPath = tryPath;
        ext = tryExt || tryPath.split(".").pop() || "";
        break;
      } catch {
        // Try next extension
      }
    }

    // Also try index files
    if (!fileContent) {
      for (const tryExt of [".tsx", ".ts", ".jsx", ".js", ".mdx"]) {
        const tryPath = `${relativePath}/index${tryExt}`;
        try {
          const content = await fs.readFile(tryPath);
          fileContent = typeof content === "string" ? content : new TextDecoder().decode(content);
          resolvedPath = tryPath;
          ext = tryExt;
          break;
        } catch {
          // Try next extension
        }
      }
    }

    if (!fileContent || !resolvedPath) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve @/${relativePath}`);
      continue;
    }

    try {
      let transformed = fileContent;

      // Transform TSX/JSX/TS files with esbuild
      if (ext === ".tsx" || ext === ".jsx" || ext === ".ts") {
        const esbuildResult = await transform(fileContent, {
          loader: ext === ".tsx" ? "tsx" : ext === ".jsx" ? "jsx" : "ts",
          jsx: "transform",
          jsxFactory: ESBUILD_JSX_FACTORY,
          jsxFragment: ESBUILD_JSX_FRAGMENT,
          format: "esm",
        });
        transformed = esbuildResult.code;

        // Add React import if JSX was used and no React import exists
        if ((ext === ".tsx" || ext === ".jsx") && !REACT_IMPORT_PATTERN.test(transformed)) {
          transformed = `import React from 'react';\n${transformed}`;
        }
      }

      // Write transformed code to temp file
      const transformedFileName = `alias-${hashString(resolvedPath)}.mjs`;
      const transformedPath = join(esmCacheDir, transformedFileName);
      await fs.writeFile(transformedPath, transformed);

      // Replace import in code
      result = result.replace(
        original,
        `import ${importClause} from "file://${transformedPath}";`,
      );

      logger.info(`${LOG_PREFIX_MDX_LOADER} Transformed @/${relativePath} -> ${transformedPath}`);
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform @/${relativePath}`, error);
    }
  }

  return result;
}
