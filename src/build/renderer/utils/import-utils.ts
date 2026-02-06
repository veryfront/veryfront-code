/**
 * Import resolution and extraction utilities
 */

import { existsSync } from "../../../platform/compat/std/fs.ts";
import { dirname, join, resolve } from "#veryfront/compat/path/index.ts";

/**
 * Extract import statements from code
 */
export function extractImports(code: string): string[] {
  const imports: string[] = [];

  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportRegex = /import\s*\(['"]([^'"]+)['"]\)/g;

  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    const path = match[1];
    if (path) imports.push(path);
  }

  while ((match = dynamicImportRegex.exec(code)) !== null) {
    const path = match[1];
    if (path) imports.push(path);
  }

  return [...new Set(imports)];
}

/**
 * Resolve import path relative to file
 */
export function resolveImportPath(
  importPath: string,
  fromFile: string,
  _projectDir: string,
): string {
  if (importPath.startsWith(".")) {
    return resolve(dirname(fromFile), importPath);
  }

  if (!importPath.startsWith("/") && !importPath.includes(":")) {
    return importPath;
  }

  return importPath;
}

/**
 * Find component file with various extensions
 */
export function findComponent(basePath: string, _projectDir: string): string | null {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = `${basePath}${ext}`;
    if (existsSync(fullPath)) return fullPath;

    const indexPath = join(basePath, `index${ext}`);
    if (existsSync(indexPath)) return indexPath;
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
  const imports = extractImports(code);
  let processedCode = code;

  for (const importPath of imports) {
    const resolvedPath = resolveImportPath(importPath, filePath, projectDir);
    const newPath = await processImport(resolvedPath);

    if (!newPath || newPath === importPath) continue;

    processedCode = processedCode.replace(
      new RegExp(`(['"])${importPath}\\1`, "g"),
      `$1${newPath}$1`,
    );
  }

  return processedCode;
}
