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
import { ESBUILD_JSX_FACTORY, ESBUILD_JSX_FRAGMENT, LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import type { FSAdapter } from "../types.ts";
import { hashString } from "../utils/hash.ts";
import { resolveFileWithExtension } from "../resolution/file-finder.ts";
import { parseImports, replaceSpecifiers } from "../../../esm/lexer.ts";

type ImportType = "project-alias" | "vf-modules";

interface AliasImport {
  specifier: string;
  relativePath: string;
  type: ImportType;
}

async function findAliasImports(code: string): Promise<AliasImport[]> {
  const imports: AliasImport[] = [];
  const parsedImports = await parseImports(code);

  for (const importSpecifier of parsedImports) {
    const specifier = importSpecifier.n;
    if (!specifier) continue;

    if (specifier.startsWith("@/")) {
      imports.push({
        specifier,
        relativePath: specifier.slice(2),
        type: "project-alias",
      });
      continue;
    }

    const normalized = specifier.replace(/^(?:file:\/\/)?\/+/, "");
    if (!normalized.startsWith("_vf_modules/")) continue;

    const modulePath = normalized.slice("_vf_modules/".length);
    const queryStart = modulePath.indexOf("?");
    const relativePath = queryStart === -1 ? modulePath : modulePath.slice(0, queryStart);
    imports.push({
      specifier,
      relativePath: relativePath.replace(/\.js$/, ""),
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
    } catch (_) {
      /* expected: file may not exist at this path */
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

async function hasReactImport(code: string): Promise<boolean> {
  const imports = await parseImports(code);
  return imports.some((importSpecifier) => importSpecifier.n === "react");
}

async function transformImport(
  imp: AliasImport,
  fs: FSAdapter,
  esmCacheDir: string,
  transform: typeof import("veryfront/extensions/bundler").transform,
): Promise<{ specifier: string; replacement: string } | null> {
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
        (extension === ".tsx" || extension === ".jsx") && !(await hasReactImport(transformed))
      ) {
        transformed = `import React from 'react';\n${transformed}`;
      }
    }

    const prefix = imp.type === "project-alias" ? "alias" : "vfmod";
    const transformedFileName = `${prefix}-${hashString(resolvedPath)}.mjs`;
    const transformedPath = join(esmCacheDir, transformedFileName);
    await fs.writeFile(transformedPath, transformed);

    logger.debug(`${LOG_PREFIX_MDX_LOADER} Transformed ${getPathDesc(imp)} -> ${transformedPath}`);

    return { specifier: imp.specifier, replacement: `file://${transformedPath}` };
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
  const imports = (await findAliasImports(code)).filter((imp) => imp.type === type);
  if (imports.length === 0) return code;

  const label = type === "project-alias" ? "@/ imports" : "/_vf_modules/ imports";
  logger.debug(`${LOG_PREFIX_MDX_LOADER} Found ${imports.length} ${label} to transform`);

  const { transform } = await import("veryfront/extensions/bundler");
  const replacements = new Map<string, string>();

  for (const imp of imports) {
    const transformed = await transformImport(imp, fs, esmCacheDir, transform);
    if (!transformed) continue;
    replacements.set(transformed.specifier, transformed.replacement);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
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
