/********************************************************************************
 * File/Dir/Stat Cache Key Builders
 *
 * Cache key builders for file system operations including file reads,
 * directory listings, stat calls, and file lists.
 *
 * @module core/cache/keys/builders/file
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { CacheKeyPrefix, type FileOperationContext } from "../prefixes.ts";
import { hashPathWithName } from "../utils.ts";

function getSourceTypeKey(sourceType: "branch" | "release" | "environment"): string {
  return sourceType === "environment" ? "env" : sourceType;
}

function buildSourceQualifier(ctx: FileOperationContext): string {
  if (ctx.sourceType === "branch") return ctx.branch ?? "main";

  if (!ctx.releaseId) {
    throw new Error(
      `Missing releaseId for ${ctx.sourceType} sourceType (project: ${ctx.projectSlug})`,
    );
  }

  if (ctx.sourceType === "release") return ctx.releaseId;

  return `${ctx.environmentName}:${ctx.releaseId}`;
}

function buildFileOperationPrefix(
  prefix: string,
  ctx: FileOperationContext | null | undefined,
  unknownKey: string,
): string {
  if (!ctx) return unknownKey;
  return `${prefix}:${getSourceTypeKey(ctx.sourceType)}:${ctx.projectSlug}:${
    buildSourceQualifier(ctx)
  }`;
}

export function buildFileCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildFileOperationPrefix(CacheKeyPrefix.FILE, ctx, "file:unknown");
}

export function buildStatCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildFileOperationPrefix(CacheKeyPrefix.STAT, ctx, "stat:unknown");
}

export function buildDirCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildFileOperationPrefix(CacheKeyPrefix.DIR, ctx, "dir:unknown");
}

export function buildFileListCacheKey(ctx: FileOperationContext | null | undefined): string {
  return buildFileOperationPrefix(CacheKeyPrefix.FILES, ctx, "files:unknown");
}

export function buildFileOperationCacheKey(prefix: string, path: string): string {
  return `${prefix}:${path}`;
}

export function buildConfigCacheKey(projectIdOrDir: string, isVirtualFilesystem: boolean): string {
  const baseKey = isVirtualFilesystem
    ? `${CacheKeyPrefix.CONFIG_VIRTUAL}:${projectIdOrDir}`
    : `${CacheKeyPrefix.CONFIG}:${hashPathWithName(projectIdOrDir)}`;

  return `${baseKey}:${VERSION}`;
}
