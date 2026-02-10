import { isFrameworkSourcePath } from "#veryfront/utils/path-utils.ts";
import { buildFileCacheKeyPrefix } from "./cache-keys.ts";
import { READ_OPERATION_EXTENSION_PRIORITY } from "./extension-priority.ts";
import type { ResolvedContentContext } from "./types.ts";

export { READ_OPERATION_EXTENSION_PRIORITY };

export interface ReadContextProviderLike {
  isProductionMode: () => boolean;
  isPersistentCacheInvalidated?: (prefix: string) => boolean;
  isReleaseBeingInvalidated?: (releaseId: string) => boolean;
}

export interface ReadFetchState {
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
}

interface BuildReadFetchStateOptions {
  normalizedPath: string;
  contentContext: ResolvedContentContext | null;
  contextProvider?: ReadContextProviderLike;
  getOriginalApiPath?: (path: string) => string;
}

export function assertProjectSourcePath(normalizedPath: string): void {
  if (!isFrameworkSourcePath(normalizedPath)) return;

  throw new Error(
    `[ReadOperations] Framework path "${normalizedPath}" cannot be fetched from API. ` +
      `Framework modules must be served from local filesystem.`,
  );
}

export function buildReadFetchState(options: BuildReadFetchStateOptions): ReadFetchState {
  const { normalizedPath, contentContext, contextProvider, getOriginalApiPath } = options;

  const apiPath = getOriginalApiPath?.(normalizedPath) ?? normalizedPath;
  const cacheKeyPrefix = buildFileCacheKeyPrefix(contentContext);
  const cacheKey = `${cacheKeyPrefix}:${normalizedPath}`;
  const isProduction = contextProvider?.isProductionMode() ?? false;
  const releaseId = contentContext?.releaseId;
  const isPrefixInvalidated =
    (isProduction && contextProvider?.isPersistentCacheInvalidated?.(cacheKeyPrefix)) ?? false;
  const isReleaseInvalidated = isProduction && releaseId
    ? contextProvider?.isReleaseBeingInvalidated?.(releaseId)
    : undefined;

  return {
    apiPath,
    cacheKeyPrefix,
    cacheKey,
    isProduction,
    hasKnownExtension: READ_OPERATION_EXTENSION_PRIORITY.some((ext) => apiPath.endsWith(ext)),
    isPreviewMode: contentContext?.sourceType === "branch",
    isPublished: contentContext?.sourceType !== "branch",
    releaseId,
    isPrefixInvalidated,
    isReleaseInvalidated,
    skipPersistentCaches: !!(isPrefixInvalidated || isReleaseInvalidated),
  };
}

export function getResolvedCacheKey(
  cacheKeyPrefix: string,
  normalizedResolvedPath: string,
): string {
  return `${cacheKeyPrefix}:${normalizedResolvedPath}`;
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

export function isNotFoundLikeError(error: unknown): boolean {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return errorMessage.includes("404") || errorMessage.includes("Not Found");
}
