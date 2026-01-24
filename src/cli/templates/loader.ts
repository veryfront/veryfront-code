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

    let relativePath = pathHelper.relative(baseDir, entryPath);

    const parts = relativePath.split("/");
    const fileName = parts[parts.length - 1] ?? "";
    const mapped = FILE_NAME_MAPPINGS[fileName];
    if (mapped) {
      parts[parts.length - 1] = mapped;
      relativePath = parts.join("/");
    }

    const content = await fs.readTextFile(entryPath);
    files.push({ path: relativePath, content });
  }
}

export function getTemplateDirectory(templateName: string): string {
  const moduleUrl = new URL(".", import.meta.url);

  if (moduleUrl.protocol !== "file:") {
    const base = moduleUrl.href;
    return pathHelper.join(base, isDeno ? "files" : "templates", templateName);
  }

  let moduleDir = moduleUrl.pathname;
  if (
    typeof process !== "undefined" &&
    process.platform === "win32" &&
    moduleDir.startsWith("/")
  ) {
    moduleDir = moduleDir.slice(1);
  }

  return pathHelper.join(moduleDir, isDeno ? "files" : "templates", templateName);
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
