import type { ResolvedContentContext } from "./types.ts";
import {
  buildDirCacheKeyPrefix as buildDirCacheKeyPrefixCore,
  buildFileCacheKeyPrefix as buildFileCacheKeyPrefixCore,
  buildFileListCacheKey as buildFileListCacheKeyCore,
  buildStatCacheKeyPrefix as buildStatCacheKeyPrefixCore,
  type FileOperationContext,
} from "#veryfront/cache";

function toFileOperationContext(
  ctx: ResolvedContentContext | null | undefined,
): FileOperationContext | null | undefined {
  if (!ctx) return ctx;

  const { sourceType, projectSlug, branch, releaseId, environmentName } = ctx;
  return { sourceType, projectSlug, branch, releaseId, environmentName };
}

export function buildFileCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildFileCacheKeyPrefixCore(toFileOperationContext(ctx));
}

export function buildStatCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildStatCacheKeyPrefixCore(toFileOperationContext(ctx));
}

export function buildDirCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildDirCacheKeyPrefixCore(toFileOperationContext(ctx));
}

export function buildFileListCacheKey(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildFileListCacheKeyCore(toFileOperationContext(ctx));
}
