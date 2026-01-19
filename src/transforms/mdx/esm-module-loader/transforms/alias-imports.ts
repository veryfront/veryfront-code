/**
 * Alias Import Transforms
 *
 * Transforms @/ aliased imports and /_vf_modules/ imports to file:// paths.
 * This module consolidates two very similar transform functions into a single,
 * unified implementation.
 *
 * @module build/transforms/mdx/esm-module-loader/transforms/alias-imports
 */

import { join } from "@std/path";
import { rendererLogger as logger } from "@veryfront/utils";
import {
  ESBUILD_JSX_FACTORY,
  ESBUILD_JSX_FRAGMENT,
  LOG_PREFIX_MDX_LOADER,
  MODULE_SERVER_IMPORT_PATTERN,
  PROJECT_ALIAS_IMPORT_PATTERN,
  REACT_IMPORT_PATTERN,
} from "../constants.ts";
import type { FSAdapter } from "../types.ts";
import { hashString } from "../utils/hash.ts";
import { resolveFileWithExtension } from "../resolution/file-finder.ts";

/**
 * Import type for alias transform operations.
 */
type ImportType = "project-alias" | "vf-modules";

interface AliasImport {
  original: string;
  importClause?: string;
  relativePath: string;
  type: ImportType;
}

/**
 * Find all alias imports in code.
 */
function findAliasImports(code: string): AliasImport[] {
  const imports: AliasImport[] = [];

  // Find @/ imports
  const projectAliasPattern = new RegExp(PROJECT_ALIAS_IMPORT_PATTERN.source, "g");
  let match;
  while ((match = projectAliasPattern.exec(code)) !== null) {
    const [original, importClause, relativePath] = match;
    if (relativePath && importClause) {
      imports.push({ original, importClause, relativePath, type: "project-alias" });
    }
  }

  // Find /_vf_modules/ imports
  const moduleServerPattern = new RegExp(MODULE_SERVER_IMPORT_PATTERN.source, "g");
  while ((match = moduleServerPattern.exec(code)) !== null) {
    const [original, modulePath] = match;
    if (modulePath) {
      // Remove .js extension if present for resolution
      const pathWithoutExt = modulePath.replace(/\.js$/, "");
      imports.push({ original, relativePath: pathWithoutExt, type: "vf-modules" });
    }
  }

  return imports;
}

/**
 * Create a file reader function from the FSAdapter.
 */
function createFileReader(fs: FSAdapter): (path: string) => Promise<string | null> {
  return async (path: string): Promise<string | null> => {
    try {
      const content = await fs.readFile(path);
      return typeof content === "string" ? content : new TextDecoder().decode(content);
    } catch {
      return null;
    }
  };
}

/**
 * Transform a single import to a file:// path.
 */
async function transformImport(
  imp: AliasImport,
  fs: FSAdapter,
  esmCacheDir: string,
  transform: typeof import("esbuild").transform,
): Promise<{ original: string; replacement: string } | null> {
  const readFile = createFileReader(fs);
  const resolved = await resolveFileWithExtension(imp.relativePath, readFile);

  if (!resolved) {
    const pathDesc = imp.type === "project-alias"
      ? `@/${imp.relativePath}`
      : `/_vf_modules/${imp.relativePath}`;
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve ${pathDesc}`);
    return null;
  }

  const { content, resolvedPath, extension } = resolved;

  try {
    let transformed = content;

    // Transform TSX/JSX/TS files with esbuild
    if (extension === ".tsx" || extension === ".jsx" || extension === ".ts") {
      const loader = extension === ".tsx" ? "tsx" : extension === ".jsx" ? "jsx" : "ts";
      const esbuildResult = await transform(content, {
        loader,
        jsx: "transform",
        jsxFactory: ESBUILD_JSX_FACTORY,
        jsxFragment: ESBUILD_JSX_FRAGMENT,
        format: "esm",
      });
      transformed = esbuildResult.code;

      // Add React import if JSX was used and no React import exists
      if (
        (extension === ".tsx" || extension === ".jsx") && !REACT_IMPORT_PATTERN.test(transformed)
      ) {
        transformed = `import React from 'react';\n${transformed}`;
      }
    }

    // Write transformed code to temp file
    const prefix = imp.type === "project-alias" ? "alias" : "vfmod";
    const transformedFileName = `${prefix}-${hashString(resolvedPath)}.mjs`;
    const transformedPath = join(esmCacheDir, transformedFileName);
    await fs.writeFile(transformedPath, transformed);

    // Build replacement based on import type
    let replacement: string;
    if (imp.type === "project-alias" && imp.importClause) {
      replacement = `import ${imp.importClause} from "file://${transformedPath}";`;
    } else {
      replacement = `from "file://${transformedPath}"`;
    }

    const pathDesc = imp.type === "project-alias"
      ? `@/${imp.relativePath}`
      : `/_vf_modules/${imp.relativePath}`;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Transformed ${pathDesc} -> ${transformedPath}`);

    return { original: imp.original, replacement };
  } catch (error) {
    const pathDesc = imp.type === "project-alias"
      ? `@/${imp.relativePath}`
      : `/_vf_modules/${imp.relativePath}`;
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform ${pathDesc}`, error);
    return null;
  }
}

/**
 * Transform @/ aliased imports to file:// paths.
 * @/ is a project-relative alias that maps to the project root.
 */
export async function transformProjectAliasImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports = findAliasImports(code).filter((imp) => imp.type === "project-alias");

  if (imports.length === 0) {
    return code;
  }

  logger.debug(`${LOG_PREFIX_MDX_LOADER} Found ${imports.length} @/ imports to transform`);

  const { transform } = await import("esbuild");
  let result = code;

  for (const imp of imports) {
    const transformed = await transformImport(imp, fs, esmCacheDir, transform);
    if (transformed) {
      result = result.replace(transformed.original, transformed.replacement);
    }
  }

  return result;
}

/**
 * Transform /_vf_modules/ imports to file:// paths.
 * These are browser-style module URLs that need to be resolved for server-side execution.
 */
export async function transformModuleServerImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
): Promise<string> {
  const imports = findAliasImports(code).filter((imp) => imp.type === "vf-modules");

  if (imports.length === 0) {
    return code;
  }

  logger.debug(
    `${LOG_PREFIX_MDX_LOADER} Found ${imports.length} /_vf_modules/ imports to transform`,
  );

  const { transform } = await import("esbuild");
  let result = code;

  for (const imp of imports) {
    const transformed = await transformImport(imp, fs, esmCacheDir, transform);
    if (transformed) {
      result = result.replace(transformed.original, transformed.replacement);
    }
  }

  return result;
}
