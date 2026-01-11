import type { ResolvedContentContext } from "./types.ts";

/**
 * Build cache key prefix for file content operations.
 * Format: file:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileCacheKeyPrefix(ctx: ResolvedContentContext | null | undefined): string {
  if (!ctx) return "file:unknown";
  switch (ctx.sourceType) {
    case "branch":
      return `file:branch:${ctx.projectSlug}:${ctx.branch ?? "main"}`;
    case "environment":
      return `file:env:${ctx.projectSlug}:${ctx.environmentName}:${ctx.releaseId ?? "unknown"}`;
    case "release":
      return `file:release:${ctx.projectSlug}:${ctx.releaseId ?? "latest"}`;
  }
}

/**
 * Build cache key prefix for stat operations.
 * Format: stat:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildStatCacheKeyPrefix(ctx: ResolvedContentContext | null | undefined): string {
  if (!ctx) return "stat:unknown";
  switch (ctx.sourceType) {
    case "branch":
      return `stat:branch:${ctx.projectSlug}:${ctx.branch ?? "main"}`;
    case "environment":
      return `stat:env:${ctx.projectSlug}:${ctx.environmentName}:${ctx.releaseId ?? "unknown"}`;
    case "release":
      return `stat:release:${ctx.projectSlug}:${ctx.releaseId ?? "latest"}`;
  }
}

/**
 * Build cache key prefix for directory operations.
 * Format: dir:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildDirCacheKeyPrefix(ctx: ResolvedContentContext | null | undefined): string {
  if (!ctx) return "dir:unknown";
  switch (ctx.sourceType) {
    case "branch":
      return `dir:branch:${ctx.projectSlug}:${ctx.branch ?? "main"}`;
    case "environment":
      return `dir:env:${ctx.projectSlug}:${ctx.environmentName}:${ctx.releaseId ?? "unknown"}`;
    case "release":
      return `dir:release:${ctx.projectSlug}:${ctx.releaseId ?? "latest"}`;
  }
}

/**
 * Build cache key for the file list based on content context.
 * Format: files:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileListCacheKey(ctx: ResolvedContentContext | null | undefined): string {
  if (!ctx) return "files:unknown";
  switch (ctx.sourceType) {
    case "branch":
      return `files:branch:${ctx.projectSlug}:${ctx.branch ?? "main"}`;
    case "environment":
      return `files:env:${ctx.projectSlug}:${ctx.environmentName}:${ctx.releaseId ?? "unknown"}`;
    case "release":
      return `files:release:${ctx.projectSlug}:${ctx.releaseId ?? "latest"}`;
  }
}
