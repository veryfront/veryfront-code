/**
 * Veryfront FS Adapter Cache Keys
 *
 * Re-exports centralized cache key builders with type adaptation for
 * ResolvedContentContext used by the Veryfront adapter.
 *
 * @module platform/adapters/fs/veryfront/cache-keys
 */

import type { ResolvedContentContext } from "./types.ts";
import {
  buildDirCacheKeyPrefix as buildDirCacheKeyPrefixCore,
  buildFileCacheKeyPrefix as buildFileCacheKeyPrefixCore,
  buildFileListCacheKey as buildFileListCacheKeyCore,
  buildStatCacheKeyPrefix as buildStatCacheKeyPrefixCore,
  type FileOperationContext,
} from "../../../../cache/keys.ts";

/**
 * Convert ResolvedContentContext to FileOperationContext.
 * These types are compatible but live in different modules.
 */
function toFileOperationContext(
  ctx: ResolvedContentContext | null | undefined,
): FileOperationContext | null | undefined {
  if (!ctx) return ctx;
  return {
    sourceType: ctx.sourceType,
    projectSlug: ctx.projectSlug,
    branch: ctx.branch,
    releaseId: ctx.releaseId,
    environmentName: ctx.environmentName,
  };
}

/**
 * Build cache key prefix for file content operations.
 * Format: file:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildFileCacheKeyPrefixCore(toFileOperationContext(ctx));
}

/**
 * Build cache key prefix for stat operations.
 * Format: stat:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildStatCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildStatCacheKeyPrefixCore(toFileOperationContext(ctx));
}

/**
 * Build cache key prefix for directory operations.
 * Format: dir:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildDirCacheKeyPrefix(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildDirCacheKeyPrefixCore(toFileOperationContext(ctx));
}

/**
 * Build cache key for the file list based on content context.
 * Format: files:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileListCacheKey(
  ctx: ResolvedContentContext | null | undefined,
): string {
  return buildFileListCacheKeyCore(toFileOperationContext(ctx));
}
