/** Discover bounded, project-contained CSS imports from project source modules. */

import {
  collectCssImportPaths,
  CSS_IMPORTING_SOURCE_EXTENSIONS,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import {
  MAX_STYLE_SOURCE_PATH_BYTES,
  utf8ByteLength,
} from "#veryfront/html/styles-builder/resource-limits.ts";
import { relative } from "#veryfront/compat/path/index.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { validatePath } from "#veryfront/security";
import type { HandlerContext } from "../types.ts";
import { type CollectedStyleSourceFile, collectStyleSourceFiles } from "./styles-source-scanner.ts";

/** Return deterministic absolute CSS import paths from one request source snapshot. */
export async function extractProjectCssImportsFromFiles(
  ctx: HandlerContext,
  files: readonly CollectedStyleSourceFile[],
): Promise<string[]> {
  const imports = collectCssImportPaths(files, ctx.projectDir);
  const canonicalImports = new Set<string>();
  for (const importPath of imports) {
    const result = await validatePath(relative(ctx.projectDir, importPath), {
      baseDir: ctx.projectDir,
      allowAbsolute: false,
      level: "normal",
      adapter: ctx.adapter,
      followSymlinks: true,
    });
    if (
      !result.valid || !result.canonicalPath ||
      result.canonicalPath.length > MAX_STYLE_SOURCE_PATH_BYTES ||
      utf8ByteLength(result.canonicalPath) > MAX_STYLE_SOURCE_PATH_BYTES
    ) {
      throw SECURITY_VIOLATION.create();
    }
    canonicalImports.add(result.canonicalPath);
  }
  return [...canonicalImports].sort();
}

/** Return deterministic absolute CSS import paths for the current project. */
export async function extractProjectCssImports(ctx: HandlerContext): Promise<string[]> {
  const files = await collectStyleSourceFiles(ctx, {
    extensions: CSS_IMPORTING_SOURCE_EXTENSIONS,
  });
  return await extractProjectCssImportsFromFiles(ctx, files);
}
