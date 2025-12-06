/**
 * Directory-based template loader
 *
 * Loads templates from actual file directories instead of inline strings.
 * Benefits:
 * - IDE support (syntax highlighting, linting, formatting)
 * - Easier to maintain and test templates
 * - No escaping issues with template literals
 * - Can use real file extensions (.tsx, .mdx, etc.)
 */

import { walk } from "std/fs/walk.ts";
import { relative } from "std/path/mod.ts";
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

  try {
    for await (
      const entry of walk(templateDir, {
        includeDirs: false,
        includeFiles: true,
        followSymlinks: false,
      })
    ) {
      // Get path relative to template directory
      let relativePath = relative(templateDir, entry.path);

      // Apply file name mappings (e.g., _gitignore -> .gitignore)
      const fileName = relativePath.split("/").pop() || "";
      if (FILE_NAME_MAPPINGS[fileName]) {
        relativePath = relativePath.replace(fileName, FILE_NAME_MAPPINGS[fileName]);
      }

      // Read file content
      const content = await Deno.readTextFile(entry.path);

      files.push({
        path: relativePath,
        content,
      });
    }
  } catch (error) {
    // If directory doesn't exist, return empty array
    if (error instanceof Deno.errors.NotFound) {
      return [];
    }
    throw error;
  }

  // Sort files for consistent ordering
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Get the absolute path to a template directory.
 * Templates are stored in src/cli/templates/files/<template-name>/
 *
 * @param templateName - Name of the template (e.g., "minimal", "ai")
 * @returns Absolute path to the template directory
 */
export function getTemplateDirectory(templateName: string): string {
  // Use import.meta.url to resolve relative to this file
  const moduleDir = new URL(".", import.meta.url).pathname;
  return `${moduleDir}files/${templateName}`;
}

/**
 * Check if a directory-based template exists.
 *
 * @param templateName - Name of the template
 * @returns True if template directory exists
 */
export async function templateDirectoryExists(templateName: string): Promise<boolean> {
  const templateDir = getTemplateDirectory(templateName);
  try {
    const stat = await Deno.stat(templateDir);
    return stat.isDirectory;
  } catch {
    return false;
  }
}
