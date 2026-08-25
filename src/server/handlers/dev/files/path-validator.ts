import type { HandlerContext } from "../../types.ts";
import {
  fromBase64Url,
  isAbsolutePath,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";

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

export type DevFilePathValidationResult =
  | Readonly<{ kind: "ready"; path: string }>
  | Readonly<{ kind: "rejected"; message: string }>;

function ready(path: string): DevFilePathValidationResult {
  return Object.freeze({ kind: "ready", path });
}

function rejected(message: string): DevFilePathValidationResult {
  return Object.freeze({ kind: "rejected", message });
}

export async function validateDevFilePath(
  encoded: string,
  ctx: HandlerContext,
): Promise<DevFilePathValidationResult> {
  const decodedPath = fromBase64Url(encoded);
  if (!decodedPath) return rejected("Invalid path encoding");

  const absPath = isAbsolutePath(decodedPath) ? decodedPath : joinPath(ctx.projectDir, decodedPath);

  if (!isWithinDirectory(ctx.projectDir, absPath)) {
    return rejected("Path outside project");
  }

  const normalizedRoot = normalizePath(ctx.projectDir);
  const normalizedTarget = normalizePath(absPath);

  let relativePath = "";
  if (normalizedTarget !== normalizedRoot) {
    relativePath = normalizedTarget.slice(normalizedRoot.length + 1);
  }

  const topLevel = relativePath.split("/")[0] ?? "";
  if (topLevel && !ALLOWED_TOP_LEVEL_DIRS.has(topLevel)) {
    return rejected("Access to directory not allowed");
  }

  try {
    const info = await ctx.adapter.fs.stat(absPath);
    if (!info.isFile) return rejected("Not a file");
  } catch (error) {
    if (isCanonicalNotFoundError(error)) return rejected("File not found");
    // Fail closed: a stat fault (EACCES, EIO, hostile rejections, ...) makes
    // the path just as unreadable as canonical absence. Mapping it to a
    // rejection keeps the handler on its no-store 404 error-module path
    // instead of letting infrastructure faults escape to a generic 500 that
    // would distinguish inaccessible paths from absent ones.
    return rejected("File not accessible");
  }

  return ready(absPath);
}
