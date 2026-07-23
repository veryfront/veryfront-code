/**
 * Import resolution and extraction utilities
 */

import { dirname, isAbsolute, join, relative, resolve } from "#veryfront/compat/path/index.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { existsSync } from "#veryfront/platform/compat/std/fs.ts";

function assertWithinProject(path: string, projectDir: string): string {
  const resolvedPath = resolve(path);
  const relativePath = relative(resolve(projectDir), resolvedPath);
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  if (
    normalizedRelativePath === ".." || normalizedRelativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError("Resolved import path is outside projectDir");
  }
  return resolvedPath;
}

/**
 * Extract import statements from code
 */
export async function extractImports(code: string): Promise<string[]> {
  const imports = await parseImports(code);
  return [...new Set(imports.flatMap((entry) => entry.n ? [entry.n] : []))];
}

/**
 * Resolve import path relative to file
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  projectDir: string,
): string {
  if (!importPath || importPath.includes("\0")) {
    throw new TypeError("Import specifier must not be empty or contain null bytes");
  }
  if (importPath.startsWith(".")) {
    return assertWithinProject(resolve(dirname(fromFile), importPath), projectDir);
  }

  if (importPath.startsWith("/")) {
    return assertWithinProject(resolve(projectDir, `.${importPath}`), projectDir);
  }

  if (!importPath.includes(":")) {
    return importPath;
  }

  return importPath;
}

/** Resolve the first supported component file for a project-contained base path. */
export function findComponent(basePath: string, projectDir: string): string | null {
  if (typeof basePath !== "string" || !basePath.trim()) {
    throw new TypeError("Component base path must not be blank");
  }
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new TypeError("projectDir must not be blank");
  }

  const resolvedBasePath = assertWithinProject(basePath, projectDir);
  for (const extension of [".tsx", ".ts", ".jsx", ".js", ".mdx"] as const) {
    const directPath = `${resolvedBasePath}${extension}`;
    if (existsSync(directPath, { isFile: true })) return directPath;

    const indexPath = join(resolvedBasePath, `index${extension}`);
    if (existsSync(indexPath, { isFile: true })) return indexPath;
  }

  return null;
}

/**
 * Process and update import paths in code
 */
export async function processImports(
  code: string,
  filePath: string,
  projectDir: string,
  processImport: (importPath: string) => Promise<string | null>,
): Promise<string> {
  const imports = await extractImports(code);
  const replacements = new Map<string, string>();

  for (const importPath of imports) {
    const resolvedPath = resolveImportPath(importPath, filePath, projectDir);
    const newPath = await processImport(resolvedPath);

    if (newPath && newPath !== importPath) replacements.set(importPath, newPath);
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier));
}
