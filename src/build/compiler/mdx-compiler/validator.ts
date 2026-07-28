import type { CompileOptions } from "./types.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors";

const fs = createFileSystem();
const MAX_PATH_LENGTH = 4_096;

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function validatePath(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (value.length > MAX_PATH_LENGTH || hasControlCharacters(value)) {
    throw new TypeError(`${name} must be a safe filesystem path`);
  }
}

export function validateCompileOptions(options: CompileOptions): void {
  if (!options || typeof options !== "object") throw new TypeError("options must be an object");
  validatePath(options.projectDir, "options.projectDir");
  validatePath(options.outputDir, "options.outputDir");
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError('options.mode must be either "development" or "production"');
  }
}

export function validateCompileParams(
  filePath: string,
  content: string,
  options: CompileOptions,
): void {
  validatePath(filePath, "filePath");
  if (!/\.mdx$/i.test(filePath)) throw new TypeError("filePath must end with .mdx");
  if (typeof content !== "string") throw new TypeError("content must be a string");
  validateCompileOptions(options);
}

export async function validateFileExists(filePath: string, content: string): Promise<void> {
  if (content.trim()) return;

  try {
    if (await fs.exists(filePath)) return;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  throw toError(
    createError({
      type: "build",
      message: `MDX file not found: ${filePath}`,
    }),
  );
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    return await fs.exists(path);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return false;
  }
}
