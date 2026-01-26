/********************************************************************************
 * Centralized Cache Key Management
 *
 * All cache keys in the system should be built using these functions to ensure:
 * 1. Consistent format across the codebase
 * 2. Automatic version-based invalidation on deployments
 * 3. Proper tenant isolation for multi-project environments
 * 4. Easy maintenance and debugging
 *
 * @module core/cache/keys
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { TRANSFORM_CACHE_VERSION } from "#veryfront/transforms/esm/package-registry.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { Span } from "@opentelemetry/api";

import {
  cacheRegistry,
  type CacheStore,
  extractProjectIdFromKey,
  isKeyForProject,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
} from "./registry.ts";

export {
  cacheRegistry,
  type CacheStore,
  extractProjectIdFromKey,
  isKeyForProject,
  LRUCacheStore,
  MapCacheStore,
  registerLRUCache,
  registerMapCache,
};

export const CacheKeyPrefix = {
  // Redis prefixes (include trailing colon for direct concatenation)
  SSR_MODULE: "veryfront:ssr-module:",
  FILE_CACHE: "veryfront:file-cache:",
  TRANSFORM: "veryfront:transform:",

  // Memory cache prefixes
  CONFIG: "config",
  CONFIG_VIRTUAL: "vf", // For virtual filesystem (API-backed) projects

  // File operation prefixes
  FILE: "file",
  STAT: "stat",
  DIR: "dir",
  FILES: "files",

  // GitHub adapter prefixes
  GITHUB_CONTENT: "github:content",
  GITHUB_BYTES: "github:bytes",
  GITHUB_DIR: "github:dir",
  GITHUB_STAT: "github:stat",
  GITHUB_TREE: "github:tree",
  GITHUB_RESOLVE: "github:resolve",

  // Module system prefixes
  MODULE_RESOLVE: "resolve",
  MODULE_PATH: "veryfront",
  SSR_VERSION: "v", // Version prefix for SSR module cache keys

  // Component cache prefixes
  COMPONENT: "component",
  LAYOUT: "layout",

  // Server-side prefixes
  ERROR_PAGE: "error",
  PROXY: "proxy",

  // Project prefixes
  PROJECT: "project",

  // Styles prefixes
  GLOBALS_CSS: "globals",
} as const;

export type FileSourceType = "branch" | "release" | "environment";

export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
): string {
  return `${projectId}:${environment}:${releaseKey}:${VERSION}`;
}

/**
 * Compute content source identifier for cache isolation.
 *
 * This is the SINGLE SOURCE OF TRUTH for contentSourceId computation.
 * Used by proxy to compute the value, and by fallback paths when proxy header is unavailable.
 *
 * @param isLocalDev - Whether this is a local development environment
 * @param environment - "preview" or "production"
 * @param branch - Branch name (for preview/local modes)
 * @param releaseId - Release ID (required for production, ignored for preview/local)
 * @returns Content source ID string:
 *   - Local: "local-{branch}"
 *   - Preview: "preview-{branch}"
 *   - Production: "release-{releaseId}"
 */
export function computeContentSourceId(
  isLocalDev: boolean,
  environment: "preview" | "production",
  branch: string | null | undefined,
  releaseId: string | null | undefined,
): string {
  if (isLocalDev) {
    return `local-${branch ?? "main"}`;
  }
  if (environment === "production") {
    if (!releaseId) {
      throw new Error("Missing releaseId for production contentSourceId");
    }
    return `release-${releaseId}`;
  }
  return `preview-${branch ?? "main"}`;
}

export function buildRenderCacheKey(cachePrefix: string, contentKey: string): string {
  return `${cachePrefix}:${contentKey}`;
}

export function parseRenderCacheKey(cacheKey: string): {
  projectId: string;
  environment: string;
  releaseKey: string;
  version: string;
  contentKey: string;
} | null {
  const parts = cacheKey.split(":");
  if (parts.length < 5) return null;

  const [projectId, environment, releaseKey, version, ...contentParts] = parts;
  if (!projectId || !environment || !releaseKey || !version) return null;

  return {
    projectId,
    environment,
    releaseKey,
    version,
    contentKey: contentParts.join(":"),
  };
}

export function buildConfigCacheKey(projectIdOrDir: string, isVirtualFilesystem: boolean): string {
  const baseKey = isVirtualFilesystem
    ? `${CacheKeyPrefix.CONFIG_VIRTUAL}:${projectIdOrDir}`
    : projectIdOrDir;

  return `${baseKey}:${VERSION}`;
}

export interface FileOperationContext {
  sourceType: FileSourceType;
  projectSlug: string;
  branch?: string | null;
  releaseId?: string | null;
  environmentName?: string | null;
}

function getSourceTypeKey(sourceType: FileSourceType): string {
  return sourceType === "environment" ? "env" : sourceType;
}

function buildSourceQualifier(ctx: FileOperationContext): string {
  switch (ctx.sourceType) {
    case "branch":
      return ctx.branch ?? "main";
    case "release":
      if (!ctx.releaseId) {
        throw new Error(`Missing releaseId for release sourceType (project: ${ctx.projectSlug})`);
      }
      return ctx.releaseId;
    case "environment":
      if (!ctx.releaseId) {
        throw new Error(
          `Missing releaseId for environment sourceType (project: ${ctx.projectSlug})`,
        );
      }
      return `${ctx.environmentName}:${ctx.releaseId}`;
  }
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

export function buildSSRModuleProjectKey(projectDir: string, projectId: string): string {
  return `${projectDir}:${projectId}`;
}

export function buildModuleTransformCacheKey(
  projectKey: string,
  modulePath: string,
  isSSR: boolean,
): string {
  return `${projectKey}:${modulePath}:${isSSR}`;
}

export function buildModuleResolveCacheKey(specifier: string, referrer?: string): string {
  return `${CacheKeyPrefix.MODULE_RESOLVE}:${specifier}:${referrer ?? "root"}`;
}

export function buildSSRModuleCacheKey(
  version: string | number,
  projectId: string,
  filePath: string,
): string {
  return `${CacheKeyPrefix.SSR_VERSION}${version}:${projectId}:${filePath}`;
}

export function buildRedisSSRModuleKey(key: string): string {
  return `${CacheKeyPrefix.SSR_MODULE}${key}`;
}

export function buildRedisFileCacheKey(key: string): string {
  return `${CacheKeyPrefix.FILE_CACHE}${key}`;
}

export function buildRedisTransformKey(key: string): string {
  return `${CacheKeyPrefix.TRANSFORM}${key}`;
}

export function buildTransformCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
): string {
  const ssrKey = ssr ? "ssr" : "browser";
  const studioKey = studioEmbed ? ":studio" : "";
  return `v${TRANSFORM_CACHE_VERSION}:${filePath}:${contentHash}:${ssrKey}${studioKey}`;
}

export function buildContentHashCacheKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  const base = `${prefix}:${filePath}:${contentHash}`;
  return suffix ? `${base}:${suffix}` : base;
}

export function buildComponentCacheKey(
  projectId: string,
  filePath: string,
  contentHash: string,
): string {
  return `${CacheKeyPrefix.COMPONENT}:${projectId}:${filePath}:${contentHash}`;
}

export function buildLayoutComponentCacheKey(
  projectId: string,
  componentPath: string,
  hash: string,
  contentSourceId: string,
): string {
  return `${CacheKeyPrefix.LAYOUT}:${projectId}:${contentSourceId}:${componentPath}:${hash}`;
}

export function buildGitHubContentCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_CONTENT}:${ref}:${path}`;
}

export function buildGitHubBytesCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_BYTES}:${ref}:${path}`;
}

export function buildGitHubDirCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_DIR}:${ref}:${path}`;
}

export function buildGitHubStatCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_STAT}:${ref}:${path}`;
}

export function buildGitHubTreeCacheKey(repoId: string, ref: string): string {
  return `${CacheKeyPrefix.GITHUB_TREE}:${repoId}:${ref}`;
}

export function buildGitHubResolveCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_RESOLVE}:${ref}:${path}`;
}

export function buildErrorPageCacheKey(
  projectId: string | undefined,
  projectDir: string,
  pageType: string,
): string {
  return `${CacheKeyPrefix.ERROR_PAGE}:${projectId ?? projectDir}:${pageType}`;
}

export function buildProxyManagerCacheKey(
  projectSlug: string,
  productionMode: boolean,
  releaseId: string | null,
  branch: string | null,
): string {
  const mode = productionMode ? "production" : "preview";
  if (productionMode && !releaseId) {
    throw new Error(`Missing releaseId in production for ${projectSlug}`);
  }
  const qualifier = productionMode ? releaseId! : (branch ?? "main");
  return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${qualifier}`;
}

export function createCacheKeyFilter(options: {
  projectId?: string;
  environment?: "production" | "preview";
  version?: string;
  prefix?: string;
}): (key: string) => boolean {
  return (key: string): boolean => {
    const parts = key.split(":");
    if (parts.length < 2) return false;

    if (options.prefix && !key.startsWith(options.prefix)) return false;

    if (options.projectId) {
      const projectId = options.projectId;
      const hasProjectId = parts[1] === projectId || (parts.length > 2 && parts[2] === projectId) ||
        parts.includes(projectId);
      if (!hasProjectId) return false;
    }

    if (options.environment && !parts.includes(options.environment)) return false;
    if (options.version && !parts.includes(options.version)) return false;

    return true;
  };
}

export function getCacheKeyVersion(): string {
  return VERSION;
}

export function getAllKeysForProject(projectId: string): Map<string, string[]> {
  return cacheRegistry.getKeysForProject(projectId);
}

export function getAllKeysForProjectAsync(
  projectId: string,
  includeRedis = true,
): Promise<{ memory: Map<string, string[]>; redis: Map<string, string[]> }> {
  return withSpan(
    SpanNames.CACHE_KEYS_GET_ALL_ASYNC,
    async (span?: Span) => {
      const result = await cacheRegistry.getAllKeysForProjectAsync(projectId, includeRedis);
      span?.setAttribute("cache.include_redis", includeRedis);
      return result;
    },
    { "cache.project_id": projectId },
  );
}

export function deleteAllKeysForProject(projectId: string): number {
  return cacheRegistry.deleteKeysForProject(projectId);
}

export function deleteAllKeysForProjectAsync(
  projectId: string,
): Promise<{ memoryDeleted: number; redisDeleted: number }> {
  return withSpan(
    SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC,
    async (span?: Span) => {
      const result = await cacheRegistry.deleteAllKeysForProjectAsync(projectId);
      span?.setAttribute("cache.memory.deleted", result.memoryDeleted);
      span?.setAttribute("cache.redis.deleted", result.redisDeleted);
      return result;
    },
    { "cache.project_id": projectId },
  );
}
