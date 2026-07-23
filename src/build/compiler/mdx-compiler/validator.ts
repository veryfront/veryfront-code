import type { CompileOptions } from "./types.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors";
import { isAbsolute } from "#veryfront/compat/path/index.ts";

const fs = createFileSystem();
export const DEFAULT_MDX_SOURCE_DIRECTORIES = ["pages", "layouts", "providers"] as const;

export function getMDXSourceDirectories(options: CompileOptions): readonly string[] {
  const directories = options.sourceDirectories ?? DEFAULT_MDX_SOURCE_DIRECTORIES;
  if (!Array.isArray(directories) || directories.length === 0) {
    throw new TypeError("options.sourceDirectories must be a non-empty array");
  }

  const unique = new Set<string>();
  for (const directory of directories) {
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("options.sourceDirectories must contain non-empty strings");
    }
    const normalized = directory.trim().replaceAll("\\", "/").replace(/^\.\//, "");
    if (
      !normalized || isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized) ||
      normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      throw new TypeError("options.sourceDirectories must contain safe project-relative paths");
    }
    if (unique.has(normalized)) {
      throw new TypeError("options.sourceDirectories must not contain duplicates");
    }
    unique.add(normalized);
  }
  return [...unique];
}

export function validateCompileOptions(options: CompileOptions): void {
  if (!options || typeof options !== "object") throw new TypeError("options must be an object");
  if (typeof options.projectDir !== "string" || options.projectDir.trim() === "") {
    throw new TypeError("options.projectDir must be a non-empty string");
  }
  if (typeof options.outputDir !== "string" || options.outputDir.trim() === "") {
    throw new TypeError("options.outputDir must be a non-empty string");
  }
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError('options.mode must be either "development" or "production"');
  }
  getMDXSourceDirectories(options);
  if (
    options.signal !== undefined &&
    !(options.signal instanceof AbortSignal)
  ) {
    throw new TypeError("options.signal must be an AbortSignal");
  }
}

export function validateCompileParams(
  filePath: string,
  content: string,
  options: CompileOptions,
): void {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    throw new TypeError("filePath must be a non-empty string");
  }
  if (typeof content !== "string") throw new TypeError("content must be a string");
  validateCompileOptions(options);
}

export async function validateFileExists(filePath: string, content: string): Promise<void> {
  if (content.trim()) return;

  if (await fs.exists(filePath)) return;

  throw toError(
    createError({
      type: "build",
      message: `MDX file not found: ${filePath}`,
    }),
  );
}

export async function pathExists(path: string): Promise<boolean> {
  if (!path) return false;
  try {
    return await fs.exists(path);
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
