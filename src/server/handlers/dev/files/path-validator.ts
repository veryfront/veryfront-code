/**
 * Path Validator
 * Validates and secures file paths for development file handler.
 * Prevents directory traversal attacks and ensures files are within project.
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
 * Validate and resolve file path from request.
 * Decodes base64url path, makes absolute, validates within project, checks file exists.
 * Returns validated absolute path or error string.
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
