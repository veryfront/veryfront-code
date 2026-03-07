import type { HandlerContext } from "../../types.ts";
import {
  fromBase64Url,
  isAbsolutePath,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";

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

export async function validateDevFilePath(
  encoded: string,
  ctx: HandlerContext,
): Promise<string> {
  const decodedPath = fromBase64Url(encoded);
  if (!decodedPath) return "Error: Invalid path encoding";

  const absPath = isAbsolutePath(decodedPath) ? decodedPath : joinPath(ctx.projectDir, decodedPath);

  if (!isWithinDirectory(ctx.projectDir, absPath)) {
    return "Error: Path outside project";
  }

  const normalizedRoot = normalizePath(ctx.projectDir);
  const normalizedTarget = normalizePath(absPath);

  let relativePath = "";
  if (normalizedTarget !== normalizedRoot) {
    relativePath = normalizedTarget.slice(normalizedRoot.length + 1);
  }

  const topLevel = relativePath.split("/")[0] ?? "";
  if (topLevel && !ALLOWED_TOP_LEVEL_DIRS.has(topLevel)) {
    return "Error: Access to directory not allowed";
  }

  try {
    const info = await ctx.adapter.fs.stat(absPath);
    if (!info.isFile) return "Error: Not a file";
  } catch (_) {
    /* expected: file may not exist */
    return "Error: File not found";
  }

  return absPath;
}
