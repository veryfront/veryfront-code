import type { ResolvedContentContext } from "./types.ts";
import {
  buildDirCacheKeyPrefix as buildDirCacheKeyPrefixCore,
  buildFileCacheKeyPrefix as buildFileCacheKeyPrefixCore,
  buildFileListCacheKey as buildFileListCacheKeyCore,
  buildStatCacheKeyPrefix as buildStatCacheKeyPrefixCore,
  type FileOperationContext,
} from "#veryfront/cache";

export type FileCacheEntryKind = "file" | "stat" | "dir" | "files";
export type FileCacheSourceKind = "branch" | "release" | "env";

const FILE_CACHE_ENTRY_KINDS: readonly FileCacheEntryKind[] = [
  "file",
  "stat",
  "dir",
  "files",
];
const FILE_CACHE_SOURCE_KINDS: readonly FileCacheSourceKind[] = [
  "branch",
  "release",
  "env",
];

export function buildProjectCachePrefix(
  entryKind: FileCacheEntryKind,
  sourceKind: FileCacheSourceKind,
  projectSlug: string,
): string {
  return `${entryKind}:${sourceKind}:${projectSlug}:`;
}

export function buildProjectCachePrefixes(projectSlug: string): string[] {
  return FILE_CACHE_ENTRY_KINDS.flatMap((entryKind) =>
    FILE_CACHE_SOURCE_KINDS.map((sourceKind) =>
      buildProjectCachePrefix(entryKind, sourceKind, projectSlug)
    )
  );
}

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
