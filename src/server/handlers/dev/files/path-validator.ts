import type { HandlerContext } from "../../types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import {
  fromBase64Url,
  isAbsolutePath,
  isWithinDirectory,
  joinPath,
  normalizePath,
} from "#veryfront/utils/path-utils.ts";
import { isSensitiveDevFilePath } from "../access-policy.ts";

const MAX_ENCODED_PATH_LENGTH = 4_096;
const MAX_DECODED_PATH_LENGTH = 3_072;
const MAX_PATH_SEGMENTS = 64;

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
  | { ok: true; path: string }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable" };

type PathFailureReason = Exclude<DevFilePathValidationResult, { ok: true }>["reason"];

function failure(reason: PathFailureReason): DevFilePathValidationResult {
  return { ok: false, reason };
}

function getAllowedRelativePath(root: string, target: string): string | null {
  const normalizedRoot = normalizePath(root);
  const normalizedTarget = normalizePath(target);
  if (
    normalizedTarget === normalizedRoot ||
    !isWithinDirectory(normalizedRoot, normalizedTarget)
  ) {
    return null;
  }

  const relativePath = normalizedTarget.slice(normalizedRoot.length + 1);
  const segments = relativePath.split("/").filter(Boolean);
  if (
    segments.length === 0 ||
    segments.length > MAX_PATH_SEGMENTS ||
    !ALLOWED_TOP_LEVEL_DIRS.has(segments[0] ?? "") ||
    isSensitiveDevFilePath(relativePath)
  ) {
    return null;
  }

  return relativePath;
}

async function inspectPathWithoutRealPath(
  root: string,
  target: string,
  ctx: HandlerContext,
): Promise<"trusted" | PathFailureReason> {
  const relativePath = getAllowedRelativePath(root, target);
  if (relativePath === null) return "invalid";

  let parent = root;
  const segments = relativePath.split("/");
  try {
    for (const [index, segment] of segments.entries()) {
      let matchingEntry:
        | { isFile: boolean; isDirectory: boolean; isSymlink: boolean }
        | undefined;
      for await (const entry of ctx.adapter.fs.readDir(parent)) {
        if (entry.name === segment) {
          matchingEntry = entry;
          break;
        }
      }

      if (!matchingEntry) return "not_found";
      if (matchingEntry.isSymlink) return "invalid";

      const isLast = index === segments.length - 1;
      if (isLast ? !matchingEntry.isFile : !matchingEntry.isDirectory) {
        return "not_found";
      }
      parent = normalizePath(joinPath(parent, segment));
    }
  } catch (error) {
    return isNotFoundError(error) ? "not_found" : "unavailable";
  }

  return "trusted";
}

export async function validateDevFilePath(
  encoded: string,
  ctx: HandlerContext,
): Promise<DevFilePathValidationResult> {
  if (encoded.length === 0 || encoded.length > MAX_ENCODED_PATH_LENGTH) {
    return failure("invalid");
  }

  const decodedPath = fromBase64Url(encoded);
  if (
    decodedPath.length === 0 ||
    decodedPath.length > MAX_DECODED_PATH_LENGTH ||
    hasUnsafeControlCharacters(decodedPath)
  ) {
    return failure("invalid");
  }

  const projectRoot = normalizePath(ctx.projectDir);
  const lexicalTarget = normalizePath(
    isAbsolutePath(decodedPath) ? decodedPath : joinPath(projectRoot, decodedPath),
  );
  if (getAllowedRelativePath(projectRoot, lexicalTarget) === null) {
    return failure("invalid");
  }

  let trustedTarget = lexicalTarget;
  if (ctx.adapter.fs.realPath) {
    let canonicalRoot: string;
    try {
      canonicalRoot = normalizePath(await ctx.adapter.fs.realPath(projectRoot));
    } catch {
      return failure("unavailable");
    }

    try {
      trustedTarget = normalizePath(await ctx.adapter.fs.realPath(lexicalTarget));
    } catch (error) {
      return failure(isNotFoundError(error) ? "not_found" : "unavailable");
    }

    if (getAllowedRelativePath(canonicalRoot, trustedTarget) === null) {
      return failure("invalid");
    }
  } else {
    const inspection = await inspectPathWithoutRealPath(projectRoot, lexicalTarget, ctx);
    if (inspection !== "trusted") return failure(inspection);
  }

  try {
    const info = await ctx.adapter.fs.stat(trustedTarget);
    if (!info.isFile) return failure("not_found");
  } catch (error) {
    return failure(isNotFoundError(error) ? "not_found" : "unavailable");
  }

  return { ok: true, path: trustedTarget };
}
