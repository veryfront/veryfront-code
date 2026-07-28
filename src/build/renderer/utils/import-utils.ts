/**
 * Import resolution and extraction utilities
 */

import { dirname, isAbsolute, join, resolve } from "#veryfront/compat/path/index.ts";
import { createFileSystem, isNotFoundError, realPath } from "#veryfront/platform/compat/fs.ts";
import { getModuleDependencies, replaceModuleImportSpecifiers } from "./module-imports.ts";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";

/**
 * Extract actual module dependencies without matching comments, strings, or
 * code examples.
 */
export function extractImports(code: string): Promise<string[]> {
  return getModuleDependencies(code);
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
export async function findComponent(
  basePath: string,
  projectDir: string,
): Promise<string | null> {
  if (!isAbsolute(projectDir)) {
    throw new TypeError("Component project directory must be absolute");
  }

  const absoluteBase = isAbsolute(basePath) ? resolve(basePath) : resolve(projectDir, basePath);
  if (!isContainedBuildPath(projectDir, absoluteBase)) {
    throw new TypeError("Component path must be inside the project directory");
  }

  const extensions = [".tsx", ".ts", ".jsx", ".js", ".mdx"];
  const fs = createFileSystem();
  const canonicalProject = await realPath(projectDir);

  for (const ext of extensions) {
    for (
      const candidate of [
        `${absoluteBase}${ext}`,
        join(absoluteBase, `index${ext}`),
      ]
    ) {
      try {
        const info = await fs.stat(candidate);
        if (!info.isFile) continue;
        const canonicalCandidate = await realPath(candidate);
        if (!isContainedBuildPath(canonicalProject, canonicalCandidate)) {
          throw new TypeError(
            "Component path resolves outside the project directory through a symbolic link",
          );
        }
        return candidate;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
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
  processImport: (resolvedPath: string, authoredSpecifier: string) => Promise<string | null>,
): Promise<string> {
  const imports = await extractImports(code);
  const replacements = new Map<string, string>();

  for (const authoredSpecifier of imports) {
    const resolvedPath = resolveImportPath(authoredSpecifier, filePath, projectDir);
    const newPath = await processImport(resolvedPath, authoredSpecifier);

    if (!newPath || newPath === authoredSpecifier) continue;
    replacements.set(authoredSpecifier, newPath);
  }

  return await replaceModuleImportSpecifiers(code, replacements);
}
