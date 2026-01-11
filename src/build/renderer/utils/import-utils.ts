/**
 * Import resolution and extraction utilities
 */

import { existsSync } from "std/fs/mod.ts";
import { dirname, join, resolve } from "@veryfront/platform/compat/path/index.ts";

/**
 * Extract import statements from code
 */
export function extractImports(code: string): string[] {
  const imports: string[] = [];

  // Match ES6 imports
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(code)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  // Match dynamic imports
  const dynamicImportRegex = /import\s*\(['"]([^'"]+)['"]\)/g;
  while ((match = dynamicImportRegex.exec(code)) !== null) {
    if (match[1]) imports.push(match[1]);
  }

  return [...new Set(imports)]; // Remove duplicates
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

  // Check if it's a node_modules import
  if (!importPath.startsWith("/") && !importPath.includes(":")) {
    return importPath; // Keep as-is for esbuild to resolve
  }

  return importPath;
}

/**
 * Find component file with various extensions
 */
export function findComponent(basePath: string, _projectDir: string): string | null {
  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];

  for (const ext of extensions) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      return fullPath;
    }

    // Check with /index suffix
    const indexPath = join(basePath, `index${ext}`);
    if (existsSync(indexPath)) {
      return indexPath;
    }
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

    if (newPath && newPath !== importPath) {
      // Replace the import path in the code
      processedCode = processedCode.replace(
        new RegExp(`(['"])${importPath}\\1`, "g"),
        `$1${newPath}$1`,
      );
    }
  }

  return processedCode;
}
