/**
 * Module Server Import Transformation
 *
 * Transforms /_vf_modules/ imports to file:// paths.
 * These are browser-style module URLs that need to be resolved for server-side execution.
 *
 * @module build/transforms/mdx/esm-loader/import-rewriter/module-server
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  LOG_PREFIX_MDX_LOADER,
  MODULE_SERVER_IMPORT_PATTERN,
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
 * Transform /_vf_modules/ imports to file:// paths.
 * Reads and transforms the source files, caching the results.
 *
 * @param code - Source code containing /_vf_modules/ imports
 * @param fs - Filesystem adapter for reading files
 * @param esmCacheDir - Directory to cache transformed files
 */
export async function transformModuleServerImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports: Array<{
    original: string;
    modulePath: string;
  }> = [];

  // Find all /_vf_modules/ imports
  let match;
  const pattern = new RegExp(MODULE_SERVER_IMPORT_PATTERN.source, "g");
  while ((match = pattern.exec(code)) !== null) {
    const [original, modulePath] = match;
    if (modulePath) {
      imports.push({ original, modulePath });
    }
  }

  if (imports.length === 0) {
    return code;
  }

  logger.info(
    `${LOG_PREFIX_MDX_LOADER} Found ${imports.length} /_vf_modules/ imports to transform`,
  );

  const { transform } = await import("esbuild/mod.js");
  let result = code;

  for (const { original, modulePath } of imports) {
    // Remove .js extension if present
    const pathWithoutExt = modulePath.replace(/\.js$/, "");

    // Try common extensions
    const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx", ""];
    let fileContent: string | null = null;
    let resolvedPath: string | null = null;
    let ext: string = "";

    for (const tryExt of extensions) {
      const tryPath = pathWithoutExt + tryExt;
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
        const tryPath = `${pathWithoutExt}/index${tryExt}`;
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
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve /_vf_modules/${modulePath}`);
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
      const transformedFileName = `vfmod-${hashString(resolvedPath)}.mjs`;
      const transformedPath = join(esmCacheDir, transformedFileName);
      await fs.writeFile(transformedPath, transformed);

      // Replace import in code
      const newFrom = `from "file://${transformedPath}"`;
      result = result.replace(original, newFrom);

      logger.info(
        `${LOG_PREFIX_MDX_LOADER} Transformed /_vf_modules/${modulePath} -> ${transformedPath}`,
      );
    } catch (error) {
      logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform /_vf_modules/${modulePath}`, error);
    }
  }

  return result;
}
