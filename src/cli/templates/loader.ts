/**
 * Directory-based template loader
 *
 * Loads templates from actual file directories instead of inline strings.
 * Uses cross-runtime platform abstractions for filesystem operations.
 * Benefits:
 * - IDE support (syntax highlighting, linting, formatting)
 * - Easier to maintain and test templates
 * - No escaping issues with template literals
 * - Can use real file extensions (.tsx, .mdx, etc.)
 */

import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import * as pathHelper from "#veryfront/platform/compat/path-helper.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import type { TemplateFile } from "./types.ts";

/**
 * Special file name mappings for npm publishing compatibility.
 * npm strips dotfiles during publish, so we use underscore prefixes.
 */
const FILE_NAME_MAPPINGS: Record<string, string> = {
  "_gitignore": ".gitignore",
  "_env": ".env",
  "_env.example": ".env.example",
  "_npmrc": ".npmrc",
  "_eslintrc.json": ".eslintrc.json",
  "_prettierrc": ".prettierrc",
};

/**
 * Load template files from a directory.
 *
 * @param templateDir - Absolute path to the template directory
 * @returns Array of template files with paths and contents
 */
export async function loadTemplateFromDirectory(
  templateDir: string,
): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];
  const fs = createFileSystem();

  try {
    await walkDirectory(templateDir, templateDir, files, fs);
  } catch (error) {
    // If directory doesn't exist, return empty array
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  // Sort files for consistent ordering
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Recursively walk a directory and collect files.
 * Uses cross-runtime filesystem abstraction.
 */
async function walkDirectory(
  baseDir: string,
  currentDir: string,
  files: TemplateFile[],
  fs: FileSystem,
): Promise<void> {
  for await (const entry of fs.readDir(currentDir)) {
    const entryPath = pathHelper.join(currentDir, entry.name);

    if (entry.isDirectory) {
      await walkDirectory(baseDir, entryPath, files, fs);
    } else if (entry.isFile) {
      let relativePath = pathHelper.relative(baseDir, entryPath);

      // Apply file name mappings (e.g., _gitignore -> .gitignore)
      const fileName = relativePath.split("/").pop() || "";
      if (FILE_NAME_MAPPINGS[fileName]) {
        relativePath = relativePath.replace(fileName, FILE_NAME_MAPPINGS[fileName]);
      }

      const content = await fs.readTextFile(entryPath);
      files.push({ path: relativePath, content });
    }
  }
}

/**
 * Get the absolute path to a template directory.
 * Templates are stored in:
 * - Deno source: src/cli/templates/files/<template-name>/
 * - npm package: dist/templates/<template-name>/
 *
 * @param templateName - Name of the template (e.g., "minimal", "ai")
 * @returns Absolute path to the template directory
 */
export function getTemplateDirectory(templateName: string): string {
  // Use import.meta.url to resolve relative to this file
  const moduleUrl = new URL(".", import.meta.url);
  // Handle both file:// URLs and regular paths
  let moduleDir: string;
  if (moduleUrl.protocol === "file:") {
    // Remove leading slash on Windows for proper path resolution
    moduleDir = moduleUrl.pathname;
    if (
      typeof process !== "undefined" && process.platform === "win32" && moduleDir.startsWith("/")
    ) {
      moduleDir = moduleDir.slice(1);
    }
  } else {
    moduleDir = moduleUrl.href;
  }

  // In Deno, templates are at ./files/<name>
  // In Node.js (npm package), templates are at ./templates/<name>
  // The bundled CLI ends up at dist/cli.js, with templates at dist/templates/
  if (isDeno) {
    return pathHelper.join(moduleDir, "files", templateName);
  }

  // In Node.js, the bundled code runs from dist/cli.js
  // Templates are at dist/templates/<name>
  return pathHelper.join(moduleDir, "templates", templateName);
}

/**
 * Check if a directory-based template exists.
 *
 * @param templateName - Name of the template
 * @returns True if template directory exists
 */
export async function templateDirectoryExists(templateName: string): Promise<boolean> {
  const templateDir = getTemplateDirectory(templateName);
  const fs = createFileSystem();

  try {
    const stat = await fs.stat(templateDir);
    return stat.isDirectory;
  } catch {
    return false;
  }
}
