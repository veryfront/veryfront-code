import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import { FILE_NOT_FOUND, INVALID_IMPORT } from "#veryfront/errors";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { READ_OPERATION_EXTENSION_PRIORITY } from "./extension-priority.ts";
import type { ResolvedContentContext } from "./types.ts";

export { READ_OPERATION_EXTENSION_PRIORITY };

export type NotFoundLikeError = Error & { code?: string };

interface ReadContextProviderLike {
  isProductionMode: () => boolean;
  isPersistentCacheInvalidated?: (prefix: string) => boolean;
  isReleaseBeingInvalidated?: (releaseId: string) => boolean;
}

interface ReadFetchState {
  apiPath: string;
  cacheKeyPrefix: string;
  cacheKey: string;
  isProduction: boolean;
  hasKnownExtension: boolean;
  isPreviewMode: boolean;
  isPublished: boolean;
  releaseId: string | null | undefined;
  isPrefixInvalidated: boolean;
  isReleaseInvalidated: boolean | undefined;
  skipPersistentCaches: boolean;
  effectiveContentContext: ResolvedContentContext | null;
}

interface BuildReadFetchStateOptions {
  normalizedPath: string;
  contentContext: ResolvedContentContext | null;
  contextProvider?: ReadContextProviderLike;
  getOriginalApiPath?: (path: string) => string;
  requestBranch?: string | null;
  cacheVariant?: string;
}

export function assertProjectSourcePath(normalizedPath: string): void {
  if (!isFrameworkSourcePath(normalizedPath)) return;

  throw INVALID_IMPORT.create({
    detail: `[ReadOperations] Framework path "${normalizedPath}" cannot be fetched from API. ` +
      `Framework modules must be served from local filesystem.`,
  });
}

export function buildReadFetchState(options: BuildReadFetchStateOptions): ReadFetchState {
  const {
    normalizedPath,
    contentContext,
    contextProvider,
    getOriginalApiPath,
    requestBranch,
    cacheVariant,
  } = options;

  const apiPath = getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
  const effectiveContentContext = contentContext?.sourceType === "branch" && requestBranch
    ? { ...contentContext, branch: requestBranch }
    : contentContext;
  const cacheKeyPrefix = buildFileCacheKeyPrefix(effectiveContentContext);
  const cacheKey = cacheVariant
    ? `${cacheKeyPrefix}|${cacheVariant.length}:${cacheVariant}:${normalizedPath}`
    : `${cacheKeyPrefix}:${normalizedPath}`;
  const isProduction = contextProvider?.isProductionMode() ?? false;
  const releaseId = effectiveContentContext?.releaseId;
  const isPrefixInvalidated = contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix) ??
    false;
  const isReleaseInvalidated = isProduction && releaseId
    ? contextProvider?.isReleaseBeingInvalidated?.(releaseId)
    : undefined;

  return {
    apiPath,
    cacheKeyPrefix,
    cacheKey,
    isProduction,
    hasKnownExtension: READ_OPERATION_EXTENSION_PRIORITY.some((ext) => apiPath.endsWith(ext)),
    isPreviewMode: effectiveContentContext?.sourceType === "branch",
    isPublished: effectiveContentContext?.sourceType !== "branch",
    releaseId,
    isPrefixInvalidated,
    isReleaseInvalidated,
    skipPersistentCaches: !!(isPrefixInvalidated || isReleaseInvalidated),
    effectiveContentContext,
  };
}

export function getResolvedCacheKey(
  cacheKeyPrefix: string,
  normalizedResolvedPath: string,
): string {
  return `${cacheKeyPrefix}:${normalizedResolvedPath}`;
}

export function buildExtensionCandidatePaths(basePath: string): string[] {
  return READ_OPERATION_EXTENSION_PRIORITY.map((ext) => `${basePath}${ext}`);
}

export function splitKnownFileExtension(
  apiPath: string,
): { originalExtension: string; basePath: string } | null {
  const extMatch = apiPath.match(/\.(tsx|ts|jsx|js|mdx|md)$/);
  if (!extMatch) return null;

  const originalExtension = extMatch[0];
  return {
    originalExtension,
    basePath: apiPath.slice(0, -originalExtension.length),
  };
}

/** Config discovery depends on each candidate name matching the source that is returned. */
export function requiresExactPublishedPath(apiPath: string): boolean {
  return /(?:^|\/)veryfront\.config\.(?:js|ts|mjs)$/.test(apiPath);
}

export function isNotFoundLikeError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = Object.getOwnPropertyDescriptor(error, "status");
    if (status && "value" in status && status.value === 404) return true;
    const code = Object.getOwnPropertyDescriptor(error, "code");
    if (code && "value" in code && code.value === "ENOENT") return true;
  }
  const errorMessage = error instanceof Error ? error.message : String(error);
  return errorMessage.includes("404") || errorMessage.includes("Not Found");
}

/**
 * Raise the framework's "this path is not in the release" error.
 *
 * Registry-branded rather than a raw `Error` so that whoever decides the
 * response status can tell an absent path from a render that faulted: the
 * `file-not-found` slug is what `resolveSSRFailure` already reads to answer
 * 404. A release whose project has been deleted answers 404 to every source
 * read, and a raw `Error` buried that routine deletion in 500s.
 *
 * `code` is kept because {@link isNotFoundLikeError} and the platform's Node
 * and Deno absence checks both read it.
 */
export function createNotFoundLikeError(path: string): NotFoundLikeError {
  return Object.assign(
    FILE_NOT_FOUND.create({
      detail: `404 Not Found: ${path}`,
      context: { path },
    }),
    { code: "ENOENT" },
  );
}
