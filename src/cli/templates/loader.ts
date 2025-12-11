
import { createFileSystem } from "../../platform/compat/fs.ts";
import * as pathHelper from "../../platform/compat/path-helper.ts";
import { isDeno } from "../../platform/compat/runtime.ts";
import type { TemplateFile } from "./types.ts";

const FILE_NAME_MAPPINGS: Record<string, string> = {
  "_gitignore": ".gitignore",
  "_env": ".env",
  "_env.example": ".env.example",
  "_npmrc": ".npmrc",
  "_eslintrc.json": ".eslintrc.json",
  "_prettierrc": ".prettierrc",
};

export async function loadTemplateFromDirectory(
  templateDir: string,
): Promise<TemplateFile[]> {
  const files: TemplateFile[] = [];
  const fs = createFileSystem();

  try {
    await walkDirectory(templateDir, templateDir, files, fs);
  } catch (error) {
    if (isDeno && error instanceof Deno.errors.NotFound) {
      return [];
    }
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function walkDirectory(
  baseDir: string,
  currentDir: string,
  files: TemplateFile[],
  fs: ReturnType<typeof createFileSystem>,
): Promise<void> {
  if (isDeno) {
    for await (const entry of Deno.readDir(currentDir)) {
      const entryPath = pathHelper.join(currentDir, entry.name);

      if (entry.isDirectory) {
        await walkDirectory(baseDir, entryPath, files, fs);
      } else if (entry.isFile) {
        let relativePath = pathHelper.relative(baseDir, entryPath);

        const fileName = relativePath.split("/").pop() || "";
        if (FILE_NAME_MAPPINGS[fileName]) {
          relativePath = relativePath.replace(fileName, FILE_NAME_MAPPINGS[fileName]);
        }

        const content = await fs.readTextFile(entryPath);
        files.push({ path: relativePath, content });
      }
    }
  } else {
    const nodeFs = await import("node:fs/promises");
    const entries = await nodeFs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = pathHelper.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await walkDirectory(baseDir, entryPath, files, fs);
      } else if (entry.isFile()) {
        let relativePath = pathHelper.relative(baseDir, entryPath);

        const fileName = relativePath.split("/").pop() || "";
        if (FILE_NAME_MAPPINGS[fileName]) {
          relativePath = relativePath.replace(fileName, FILE_NAME_MAPPINGS[fileName]);
        }

        const content = await fs.readTextFile(entryPath);
        files.push({ path: relativePath, content });
      }
    }
  }
}

export function getTemplateDirectory(templateName: string): string {
  const moduleUrl = new URL(".", import.meta.url);
  let moduleDir: string;
  if (moduleUrl.protocol === "file:") {
    moduleDir = moduleUrl.pathname;
    if (
      typeof process !== "undefined" && process.platform === "win32" && moduleDir.startsWith("/")
    ) {
      moduleDir = moduleDir.slice(1);
    }
  } else {
    moduleDir = moduleUrl.href;
  }

  if (isDeno) {
    return pathHelper.join(moduleDir, "files", templateName);
  } else {
    return pathHelper.join(moduleDir, "templates", templateName);
  }
}

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
