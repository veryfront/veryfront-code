/**
 * Alias Import Transforms
 *
 * Transforms @/ aliased imports and /_vf_modules/ imports to file:// paths.
 * This module consolidates two very similar transform functions into a single,
 * unified implementation.
 *
 * @module build/transforms/mdx/esm-module-loader/transforms/alias-imports
 */

import { join } from "#veryfront/compat/path";
import { rendererLogger as logger } from "#veryfront/utils";
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

type ImportType = "project-alias" | "vf-modules";

interface AliasImport {
  original: string;
  importClause?: string;
  relativePath: string;
  type: ImportType;
}

function findAliasImports(code: string): AliasImport[] {
  const imports: AliasImport[] = [];

  const projectAliasPattern = new RegExp(PROJECT_ALIAS_IMPORT_PATTERN.source, "g");
  let match: RegExpExecArray | null;

  while ((match = projectAliasPattern.exec(code)) !== null) {
    const [original, importClause, relativePath] = match;
    if (!relativePath || !importClause) continue;
    imports.push({ original, importClause, relativePath, type: "project-alias" });
  }

  const moduleServerPattern = new RegExp(MODULE_SERVER_IMPORT_PATTERN.source, "g");
  while ((match = moduleServerPattern.exec(code)) !== null) {
    const [original, modulePath] = match;
    if (!modulePath) continue;
    imports.push({
      original,
      relativePath: modulePath.replace(/\.js$/, ""),
      type: "vf-modules",
    });
  }

  return imports;
}

function createFileReader(fs: FSAdapter): (path: string) => Promise<string | null> {
  const decoder = new TextDecoder();

  return async (path: string): Promise<string | null> => {
    try {
      const content = await fs.readFile(path);
      return typeof content === "string" ? content : decoder.decode(content);
    } catch {
      return null;
    }
  };
}

function getPathDesc(imp: AliasImport): string {
  return imp.type === "project-alias"
    ? `@/${imp.relativePath}`
    : `/_vf_modules/${imp.relativePath}`;
}

function getEsbuildLoader(extension: string): "tsx" | "jsx" | "ts" | null {
  if (extension === ".tsx") return "tsx";
  if (extension === ".jsx") return "jsx";
  if (extension === ".ts") return "ts";
  return null;
}

async function transformImport(
  imp: AliasImport,
  fs: FSAdapter,
  esmCacheDir: string,
  transform: typeof import("esbuild").transform,
): Promise<{ original: string; replacement: string } | null> {
  const readFile = createFileReader(fs);
  const resolved = await resolveFileWithExtension(imp.relativePath, readFile);

  if (!resolved) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Could not resolve ${getPathDesc(imp)}`);
    return null;
  }

  const { content, resolvedPath, extension } = resolved;

  try {
    let transformed = content;

    const loader = getEsbuildLoader(extension);
    if (loader) {
      const esbuildResult = await transform(content, {
        loader,
        jsx: "transform",
        jsxFactory: ESBUILD_JSX_FACTORY,
        jsxFragment: ESBUILD_JSX_FRAGMENT,
        format: "esm",
      });

      transformed = esbuildResult.code;

      if (
        (extension === ".tsx" || extension === ".jsx") && !REACT_IMPORT_PATTERN.test(transformed)
      ) {
        transformed = `import React from 'react';\n${transformed}`;
      }
    }

    const prefix = imp.type === "project-alias" ? "alias" : "vfmod";
    const transformedFileName = `${prefix}-${hashString(resolvedPath)}.mjs`;
    const transformedPath = join(esmCacheDir, transformedFileName);
    await fs.writeFile(transformedPath, transformed);

    const replacement = imp.type === "project-alias" && imp.importClause
      ? `import ${imp.importClause} from "file://${transformedPath}";`
      : `from "file://${transformedPath}"`;

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Transformed ${getPathDesc(imp)} -> ${transformedPath}`);

    return { original: imp.original, replacement };
  } catch (error) {
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Failed to transform ${getPathDesc(imp)}`, error);
    return null;
  }
}

async function transformAliasImports(
  code: string,
  fs: FSAdapter,
  esmCacheDir: string,
  type: ImportType,
): Promise<string> {
  const imports = findAliasImports(code).filter((imp) => imp.type === type);
  if (imports.length === 0) return code;

  const label = type === "project-alias" ? "@/ imports" : "/_vf_modules/ imports";
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Found ${imports.length} ${label} to transform`);

  const { transform } = await import("esbuild");
  let result = code;

  for (const imp of imports) {
    const transformed = await transformImport(imp, fs, esmCacheDir, transform);
    if (!transformed) continue;
    result = result.replace(transformed.original, transformed.replacement);
  }

  return result;
}

type AliasImportTransformer = (code: string, fs: FSAdapter, esmCacheDir: string) => Promise<string>;

function createAliasImportTransformer(type: ImportType): AliasImportTransformer {
  return (code, fs, esmCacheDir) => transformAliasImports(code, fs, esmCacheDir, type);
}

/**
 * Transform @/ aliased imports to file:// paths.
 * @/ is a project-relative alias that maps to the project root.
 */
export const transformProjectAliasImports = createAliasImportTransformer("project-alias");

/**
 * Transform /_vf_modules/ imports to file:// paths.
 * These are browser-style module URLs that need to be resolved for server-side execution.
 */
export const transformModuleServerImports = createAliasImportTransformer("vf-modules");
