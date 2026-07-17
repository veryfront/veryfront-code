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
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { encodeCacheSourceIdentity, type EncodedCacheSourceIdentity } from "../source-identity.ts";

function encodeFileSourceIdentity(ctx: FileOperationContext): EncodedCacheSourceIdentity {
  if (ctx.sourceType === "branch") {
    return encodeCacheSourceIdentity({ type: "branch", branch: ctx.branch ?? "main" });
  }

  if (!ctx.releaseId) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `Missing releaseId for ${ctx.sourceType} sourceType (project: ${ctx.projectSlug})`,
    });
  }

  if (ctx.sourceType === "release") {
    return encodeCacheSourceIdentity({ type: "release", releaseId: ctx.releaseId });
  }

  return encodeCacheSourceIdentity({
    type: "environment",
    environmentName: ctx.environmentName ?? "",
    releaseId: ctx.releaseId,
  });
}

function buildFileOperationPrefix(
  prefix: string,
  ctx: FileOperationContext | null | undefined,
  unknownKey: string,
): string {
  if (!ctx) return unknownKey;
  const source = encodeFileSourceIdentity(ctx);
  const sourceTypeKey = source.type === "environment" ? "env" : source.type;
  return `${prefix}:${sourceTypeKey}:${ctx.projectSlug}:${source.qualifier}`;
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

export interface VirtualConfigSourceContext {
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
}

function buildVirtualConfigSourceQualifier(context: VirtualConfigSourceContext): string {
  if (!context.productionMode) {
    const source = encodeCacheSourceIdentity({
      type: "branch",
      branch: context.branch ?? "main",
    });
    return `source:${source.key}`;
  }

  if (!context.releaseId) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Virtual production config cache keys require a releaseId",
    });
  }

  const source = context.environmentName
    ? encodeCacheSourceIdentity({
      type: "environment",
      environmentName: context.environmentName,
      releaseId: context.releaseId,
    })
    : encodeCacheSourceIdentity({ type: "release", releaseId: context.releaseId });
  return `source:${source.key}`;
}

export function buildConfigCacheKey(
  projectIdOrDir: string,
  isVirtualFilesystem: boolean,
  sourceContext?: VirtualConfigSourceContext,
): string {
  const baseKey = isVirtualFilesystem
    ? `${CacheKeyPrefix.CONFIG_VIRTUAL}:${projectIdOrDir}${
      sourceContext ? `:${buildVirtualConfigSourceQualifier(sourceContext)}` : ""
    }`
    : `${CacheKeyPrefix.CONFIG}:${hashPathWithName(projectIdOrDir)}`;

  return `${baseKey}:${VERSION}`;
}
