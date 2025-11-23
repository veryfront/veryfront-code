/**
 * Path Validator
 *
 * Validates and secures file paths for development file handler.
 * Prevents directory traversal attacks and ensures files are within project.
 *
 * @module server/handlers/dev/files/path-validator
 */

import type { HandlerContext } from "../../types.ts";
import {
  fromBase64Url,
  isAbsolutePath,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "@veryfront/utils/path-utils.ts";

const ALLOWED_TOP_LEVEL_DIRS = new Set([
  "app",
  "pages",
  "src",
  "components",
  "islands",
  "public",
  "shared",
  "modules",
  "server",
  "client",
  "lib",
  "routes",
]);

/**
 * Validate and resolve file path from request
 *
 * Process:
 * 1. Decode base64url-encoded path from URL
 * 2. Make path absolute relative to projectDir
 * 3. Validate path is within project directory
 * 4. Check file exists and is a regular file
 *
 * @param encoded - Base64url-encoded path from request URL
 * @param ctx - Handler context with projectDir and adapter
 * @returns Validated absolute path or error string
 *
 * @example
 * ```typescript
 * const result = await validateDevFilePath('YXBwL3BhZ2UudHN4', ctx);
 * if (typeof result === 'string' && result.includes('Error:')) {
 *   // Handle error
 * } else {
 *   // result is valid absolute path
 * }
 * ```
 */
export async function validateDevFilePath(
  encoded: string,
  ctx: HandlerContext,
): Promise<string> {
  // Decode path
  let absPath = fromBase64Url(encoded);

  if (!absPath) {
    return "Error: Invalid path encoding";
  }

  // Make path absolute if needed
  if (!isAbsolutePath(absPath)) {
    absPath = joinPath(ctx.projectDir, absPath);
  }

  // Security check: prevent directory traversal
  if (!isWithinDirectory(ctx.projectDir, absPath)) {
    return "Error: Path outside project";
  }

  const normalizedRoot = normalizePath(ctx.projectDir);
  const normalizedTarget = normalizePath(absPath);
  const relativePath = normalizedTarget === normalizedRoot
    ? ""
    : normalizedTarget.slice(normalizedRoot.length + 1);

  const topLevel = relativePath.split("/")[0] ?? "";
  if (topLevel && !ALLOWED_TOP_LEVEL_DIRS.has(topLevel)) {
    return "Error: Access to directory not allowed";
  }

  // Check if file exists and is a regular file
  try {
    const info = await ctx.adapter.fs.stat(absPath);
    if (!info.isFile) {
      return "Error: Not a file";
    }
  } catch {
    return "Error: File not found";
  }

  return absPath;
}
