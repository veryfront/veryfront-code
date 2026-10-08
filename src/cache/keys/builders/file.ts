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
import { API_CACHE_KEY_MAX_LENGTH, isCacheKeyPassThroughSafe } from "../api-policy.ts";
import { encodeCacheKeySegment } from "../segment-codec.ts";
import { hashPathWithName } from "../utils.ts";
import { hashString } from "../../hash.ts";

import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { encodeCacheSourceIdentity, type EncodedCacheSourceIdentity } from "../source-identity.ts";

// Leave room for the request-authority suffix on a shared listing key.
const MAX_FILE_LIST_SOURCE_KEY_LENGTH = API_CACHE_KEY_MAX_LENGTH - 64;

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

/** Literal prefix of versioned immutable release file keys. */
export const VERSIONED_RELEASE_FILE_KEY_PREFIX = "file:release-v2:";

/**
 * Project-scoped prefix of versioned operation keys for one source type, for
 * invalidations that know the project but not the exact source.
 */
export function buildVersionedFileOperationProjectPrefix(
  prefix: string,
  sourceType: "branch" | "release" | "env",
  projectSlug: string,
): string {
  return `${prefix}:${sourceType}-v2:${encodeCacheKeySegment(projectSlug)}:`;
}

function encodeVersionedQualifier(ctx: FileOperationContext): string {
  if (ctx.sourceType === "branch") return encodeCacheKeySegment(ctx.branch ?? "main");
  const { releaseId } = ctx;
  if (!releaseId) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `Missing releaseId for ${ctx.sourceType} sourceType (project: ${ctx.projectSlug})`,
    });
  }
  if (ctx.sourceType === "release") return encodeCacheKeySegment(releaseId);
  return `${encodeCacheKeySegment(ctx.environmentName ?? "")}:${encodeCacheKeySegment(releaseId)}`;
}

/** Whether an operation prefix can use the raw project identity safely. */
export function canUseLegacyFileOperationPrefix(prefix: string, projectSlug: string): boolean {
  return isCacheKeyPassThroughSafe(`${prefix}:entry`) && !projectSlug.includes(":");
}

// Keep ordinary prefixes stable. Version the source type when URI escaping
// would make the API rewrite a concrete key or refuse its deletion glob.
function buildApiFileOperationPrefix(
  prefix: string,
  ctx: FileOperationContext | null | undefined,
  unknownKey: string,
): string {
  const legacy = buildFileOperationPrefix(prefix, ctx, unknownKey);
  if (!ctx) return legacy;
  if (canUseLegacyFileOperationPrefix(legacy, ctx.projectSlug)) return legacy;
  const sourceType = ctx.sourceType === "environment" ? "env" : ctx.sourceType;
  return `${buildVersionedFileOperationProjectPrefix(prefix, sourceType, ctx.projectSlug)}${
    encodeVersionedQualifier(ctx)
  }`;
}

/** Marker between a file/stat/directory source prefix and its cache scope. */
export const FILE_OPERATION_SCOPE_MARKER = "scope";

/**
 * Scope a file/stat/directory source prefix to a cache variant, such as the
 * request credential, in an API-safe shape. The marker is always emitted, so
 * scoped and unscoped identities never alias, and it follows the complete
 * source prefix, so ownership decoding and source deletion globs still match.
 */
export function scopeFileOperationCacheKeyPrefix(prefix: string, variant?: string): string {
  return `${prefix}:${FILE_OPERATION_SCOPE_MARKER}:${encodeCacheKeySegment(variant ?? "")}`;
}

export function buildFileCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildApiFileOperationPrefix(CacheKeyPrefix.FILE, ctx, "file:unknown");
}

export function buildStatCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildApiFileOperationPrefix(CacheKeyPrefix.STAT, ctx, "stat:unknown");
}

export function buildDirCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  return buildApiFileOperationPrefix(CacheKeyPrefix.DIR, ctx, "dir:unknown");
}

/**
 * Project prefix shared by every file-list key of one source type, for broad
 * publish invalidations that know the project but not the exact source.
 */
export function buildFileListProjectPrefix(
  sourceType: "branch" | "release" | "env",
  projectSlug: string,
): string {
  // A delimiter in the slug could forge another project's fallback segments.
  const project = !projectSlug.includes(":") && isCacheKeyPassThroughSafe(`${projectSlug}:`)
    ? projectSlug
    : encodeCacheKeySegment(projectSlug);
  return `${CacheKeyPrefix.FILES}:${sourceType}:${project}:`;
}

export function buildFileListCacheKey(ctx: FileOperationContext | null | undefined): string {
  const sourceKey = buildFileOperationPrefix(CacheKeyPrefix.FILES, ctx, "files:unknown");
  if (
    !ctx ||
    isCacheKeyPassThroughSafe(`${sourceKey}:authority:entry`) &&
      sourceKey.length <= MAX_FILE_LIST_SOURCE_KEY_LENGTH &&
      !ctx.projectSlug.includes(":")
  ) return sourceKey;

  // Keep the project prefix used by broad publish invalidation. Reserve extra
  // segments so encoded identities cannot alias an ordinary source.
  const sourceType = ctx.sourceType === "environment" ? "env" : ctx.sourceType;
  const prefix = buildFileListProjectPrefix(sourceType, ctx.projectSlug);
  const encoded = `${prefix}encoded:${encodeCacheKeySegment(sourceKey)}:source:value`;
  if (encoded.length <= MAX_FILE_LIST_SOURCE_KEY_LENGTH) return encoded;

  // Match the bounded, domain-separated 128-bit source identities used by
  // other synchronous cache-key builders for inputs too long to inline.
  return `${prefix}hashed:${hashString(`file-list-source:a:${sourceKey}`)}:${
    hashString(`file-list-source:b:${sourceKey}`)
  }:source:value`;
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
