import type { CompileOptions } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

export function validateCompileParams(
  filePath: string,
  content: string,
  options: CompileOptions,
): void {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("filePath must be a non-empty string");
  }
  if (typeof content !== "string") {
    throw new TypeError("content must be a string");
  }
  if (!options || typeof options !== "object") {
    throw new TypeError("options must be an object");
  }
  if (!options.projectDir || typeof options.projectDir !== "string") {
    throw new TypeError("options.projectDir must be a non-empty string");
  }
  if (!options.outputDir || typeof options.outputDir !== "string") {
    throw new TypeError("options.outputDir must be a non-empty string");
  }
  if (options.mode !== "development" && options.mode !== "production") {
    throw new TypeError('options.mode must be either "development" or "production"');
  }
}

export async function validateFileExists(filePath: string, content: string): Promise<void> {
  if (!content || content.trim() === "") {
    try {
      await Deno.stat(filePath);
    } catch (_error) {
      throw toError(createError({
        type: "build",
        message: `MDX file not found: ${filePath}`,
      }));
    }
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
