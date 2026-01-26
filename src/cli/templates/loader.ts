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
import type { TemplateFile } from "./types.ts";

/**
 * Special file name mappings for npm publishing compatibility.
 * npm strips dotfiles during publish, so we use underscore prefixes.
 */
const FILE_NAME_MAPPINGS: Record<string, string> = {
  _gitignore: ".gitignore",
  _env: ".env",
  "_env.example": ".env.example",
  _npmrc: ".npmrc",
  "_eslintrc.json": ".eslintrc.json",
  _prettierrc: ".prettierrc",
};

export async function loadTemplateFromDirectory(
  templateDir: string,
): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];
  const fs = createFileSystem();

  try {
    await walkDirectory(templateDir, templateDir, files, fs);
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

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
      continue;
    }

    if (!entry.isFile) continue;

    const relativePath = processRelativePath(
      pathHelper.relative(baseDir, entryPath),
    );

    const content = (await fs.readTextFile(entryPath))
      .replace(/^\/\/ @ts-nocheck[^\n]*\n/, "");

    files.push({ path: relativePath, content });
  }
}

function processRelativePath(relativePath: string): string {
  // Strip .template suffix (used to prevent deno compile from analyzing .ts/.tsx files)
  if (relativePath.endsWith(".template")) {
    relativePath = relativePath.slice(0, -".template".length);
  }

  // Apply file name mappings for dotfiles (npm strips dotfiles during publish)
  const parts = relativePath.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  const mapped = FILE_NAME_MAPPINGS[fileName];
  if (mapped) {
    parts[parts.length - 1] = mapped;
    return parts.join("/");
  }

  return relativePath;
}

export function getTemplateDirectory(templateName: string): string {
  const moduleUrl = new URL(".", import.meta.url);

  // Always use "files" directory - this is where templates are stored
  // in both Deno source and npm build
  if (moduleUrl.protocol !== "file:") {
    const base = moduleUrl.href;
    return pathHelper.join(base, "files", templateName);
  }

  let moduleDir = moduleUrl.pathname;
  if (
    typeof process !== "undefined" &&
    process.platform === "win32" &&
    moduleDir.startsWith("/")
  ) {
    moduleDir = moduleDir.slice(1);
  }

  return pathHelper.join(moduleDir, "files", templateName);
}

export async function templateDirectoryExists(templateName: string): Promise<boolean> {
  const templateDir = getTemplateDirectory(templateName);
  const fs = createFileSystem();

  try {
    return (await fs.stat(templateDir)).isDirectory;
  } catch {
    return false;
  }
}
