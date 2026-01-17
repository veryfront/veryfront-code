/**
 * Centralized Cache Key Management
 *
 * All cache keys in the system should be built using these functions to ensure:
 * 1. Consistent format across the codebase
 * 2. Automatic version-based invalidation on deployments
 * 3. Proper tenant isolation for multi-project environments
 * 4. Easy maintenance and debugging
 *
 * ## Cache Key Strategies
 *
 * 1. **RENDER CACHE** - For rendered pages and page data
 *    Format: {projectId}:{environment}:{releaseKey}:{version}:{contentKey}
 *    Example: proj_123:production:rel_456:0.1.0:page:blog/post
 *
 * 2. **CONFIG CACHE** - For project configuration
 *    Format: {projectId}:{version} or vf:{projectId}:{version}
 *    Example: vf:codersociety:0.1.0
 *
 * 3. **FILE CACHE** - For filesystem operations (Veryfront API adapter)
 *    Format: {operation}:{sourceType}:{projectSlug}:{qualifier}:{path}
 *    Example: file:release:codersociety:rel_456:/pages/index.tsx
 *
 * 4. **MODULE CACHE** - For compiled modules
 *    Format: {prefix}:{projectId}:{filePath}:{contentHash}:{target}
 *    Example: veryfront:ssr-module:proj_123:/pages/index.tsx:abc123:ssr
 *
 * 5. **TRANSFORM CACHE** - For code transformations
 *    Format: {prefix}:{filePath}:{contentHash}:{suffix}
 *    Example: veryfront:transform:/pages/index.tsx:abc123:browser
 *
 * @module core/cache/keys
 */

import { VERSION } from "@veryfront/utils/version.ts";

// ============================================================================
// CACHE KEY PREFIXES (Constants)
// ============================================================================

/**
 * All cache key prefixes used in the system.
 * Using constants ensures consistency and makes refactoring easier.
 */
export const CacheKeyPrefix = {
  // Redis prefixes
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
} as const;

/**
 * Source types for file operations.
 */
export type FileSourceType = "branch" | "release" | "environment";

// ============================================================================
// RENDER CACHE KEYS
// ============================================================================

/**
 * Build a render cache prefix for tenant isolation.
 * Format: {projectId}:{environment}:{releaseKey}:{version}
 *
 * @example
 * buildRenderCachePrefix("proj_123", "production", "rel_456")
 * // → "proj_123:production:rel_456:0.1.0"
 */
export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
): string {
  return `${projectId}:${environment}:${releaseKey}:${VERSION}`;
}

/**
 * Build a full render cache key.
 * Format: {cachePrefix}:{contentKey}
 *
 * @example
 * buildRenderCacheKey("proj_123:production:rel_456:0.1.0", "page:blog/post")
 * // → "proj_123:production:rel_456:0.1.0:page:blog/post"
 */
export function buildRenderCacheKey(cachePrefix: string, contentKey: string): string {
  return `${cachePrefix}:${contentKey}`;
}

/**
 * Parse a render cache key into its components.
 * Returns null if the key doesn't match the expected format.
 */
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
  if (!projectId || !environment || !releaseKey || !version) {
    return null;
  }

  return {
    projectId,
    environment,
    releaseKey,
    version,
    contentKey: contentParts.join(":"),
  };
}

// ============================================================================
// CONFIG CACHE KEYS
// ============================================================================

/**
 * Build a config cache key.
 * For virtual filesystem (API-backed): vf:{projectId}:{version}
 * For local filesystem: {projectDir}:{version}
 *
 * @example
 * buildConfigCacheKey("codersociety", true)  // → "vf:codersociety:0.1.0"
 * buildConfigCacheKey("/path/to/project", false)  // → "/path/to/project:0.1.0"
 */
export function buildConfigCacheKey(
  projectIdOrDir: string,
  isVirtualFilesystem: boolean,
): string {
  const baseKey = isVirtualFilesystem
    ? `${CacheKeyPrefix.CONFIG_VIRTUAL}:${projectIdOrDir}`
    : projectIdOrDir;
  return `${baseKey}:${VERSION}`;
}

// ============================================================================
// FILE OPERATION CACHE KEYS (Veryfront API Adapter)
// ============================================================================

/**
 * Context for building file operation cache keys.
 */
export interface FileOperationContext {
  sourceType: FileSourceType;
  projectSlug: string;
  branch?: string | null;
  releaseId?: string | null;
  environmentName?: string | null;
}

/**
 * Build a qualifier string based on source type.
 */
function buildSourceQualifier(ctx: FileOperationContext): string {
  switch (ctx.sourceType) {
    case "branch":
      return ctx.branch ?? "main";
    case "release":
      return ctx.releaseId ?? "latest";
    case "environment":
      return `${ctx.environmentName}:${ctx.releaseId ?? "unknown"}`;
  }
}

/**
 * Build a file content cache key prefix.
 * Format: file:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  if (!ctx) return "file:unknown";
  const qualifier = buildSourceQualifier(ctx);
  return `${CacheKeyPrefix.FILE}:${ctx.sourceType}:${ctx.projectSlug}:${qualifier}`;
}

/**
 * Build a file stat cache key prefix.
 * Format: stat:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildStatCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  if (!ctx) return "stat:unknown";
  const qualifier = buildSourceQualifier(ctx);
  return `${CacheKeyPrefix.STAT}:${ctx.sourceType}:${ctx.projectSlug}:${qualifier}`;
}

/**
 * Build a directory cache key prefix.
 * Format: dir:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildDirCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string {
  if (!ctx) return "dir:unknown";
  const qualifier = buildSourceQualifier(ctx);
  return `${CacheKeyPrefix.DIR}:${ctx.sourceType}:${ctx.projectSlug}:${qualifier}`;
}

/**
 * Build a file list cache key.
 * Format: files:{sourceType}:{projectSlug}:{qualifier}
 */
export function buildFileListCacheKey(ctx: FileOperationContext | null | undefined): string {
  if (!ctx) return "files:unknown";
  const qualifier = buildSourceQualifier(ctx);
  return `${CacheKeyPrefix.FILES}:${ctx.sourceType}:${ctx.projectSlug}:${qualifier}`;
}

/**
 * Build a full file operation cache key.
 * Format: {prefix}:{path}
 */
export function buildFileOperationCacheKey(prefix: string, path: string): string {
  return `${prefix}:${path}`;
}

// ============================================================================
// MODULE CACHE KEYS
// ============================================================================

/**
 * Build an SSR module cache key.
 * Format: {projectDir}:{projectId}
 */
export function buildSSRModuleProjectKey(projectDir: string, projectId: string): string {
  return `${projectDir}:${projectId}`;
}

/**
 * Build a module transform cache key.
 * Format: {projectKey}:{modulePath}:{isSSR}
 */
export function buildModuleTransformCacheKey(
  projectKey: string,
  modulePath: string,
  isSSR: boolean,
): string {
  return `${projectKey}:${modulePath}:${isSSR}`;
}

/**
 * Build a module resolve cache key.
 * Format: {specifier}::{referrer}
 */
export function buildModuleResolveCacheKey(specifier: string, referrer?: string): string {
  return `${specifier}::${referrer || "root"}`;
}

/**
 * Build a Redis SSR module cache key.
 * Format: veryfront:ssr-module:{key}
 */
export function buildRedisSSRModuleKey(key: string): string {
  return `${CacheKeyPrefix.SSR_MODULE}${key}`;
}

/**
 * Build a Redis file cache key.
 * Format: veryfront:file-cache:{key}
 */
export function buildRedisFileCacheKey(key: string): string {
  return `${CacheKeyPrefix.FILE_CACHE}${key}`;
}

/**
 * Build a Redis transform cache key.
 * Format: veryfront:transform:{key}
 */
export function buildRedisTransformKey(key: string): string {
  return `${CacheKeyPrefix.TRANSFORM}${key}`;
}

// ============================================================================
// CONTENT-ADDRESSABLE CACHE KEYS
// ============================================================================

/**
 * Build a content-addressable cache key.
 * Use for caches where same content = same output (transforms, modules).
 *
 * Format: {prefix}:{filePath}:{contentHash}:{suffix?}
 *
 * @example
 * buildContentHashKey("veryfront:transform", "pages/index.tsx", "abc123", "ssr")
 * // → "veryfront:transform:pages/index.tsx:abc123:ssr"
 */
export function buildContentHashKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  const base = `${prefix}:${filePath}:${contentHash}`;
  return suffix ? `${base}:${suffix}` : base;
}

/**
 * Build a component cache key.
 * Format: {projectId}:{filePath}:{contentHash}
 */
export function buildComponentCacheKey(
  projectId: string,
  filePath: string,
  contentHash: string,
): string {
  return `${projectId}:${filePath}:${contentHash}`;
}

/**
 * Build a layout component cache key.
 * Format: {componentPath}:{hash}
 */
export function buildLayoutComponentCacheKey(componentPath: string, hash: string): string {
  return `${componentPath}:${hash}`;
}

// ============================================================================
// GITHUB ADAPTER CACHE KEYS
// ============================================================================

/**
 * Build a GitHub content cache key.
 * Format: github:content:{ref}:{path}
 */
export function buildGitHubContentCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_CONTENT}:${ref}:${path}`;
}

/**
 * Build a GitHub bytes cache key.
 * Format: github:bytes:{ref}:{path}
 */
export function buildGitHubBytesCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_BYTES}:${ref}:${path}`;
}

/**
 * Build a GitHub directory cache key.
 * Format: github:dir:{ref}:{path}
 */
export function buildGitHubDirCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_DIR}:${ref}:${path}`;
}

/**
 * Build a GitHub stat cache key.
 * Format: github:stat:{ref}:{path}
 */
export function buildGitHubStatCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_STAT}:${ref}:${path}`;
}

/**
 * Build a GitHub tree cache key.
 * Format: github:tree:{repoId}:{ref}
 */
export function buildGitHubTreeCacheKey(repoId: string, ref: string): string {
  return `${CacheKeyPrefix.GITHUB_TREE}:${repoId}:${ref}`;
}

/**
 * Build a GitHub resolve cache key.
 * Format: github:resolve:{ref}:{path}
 */
export function buildGitHubResolveCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_RESOLVE}:${ref}:${path}`;
}

// ============================================================================
// ERROR PAGE CACHE KEYS
// ============================================================================

/**
 * Build an error page cache key.
 * Format: {projectId}:{pageType}
 */
export function buildErrorPageCacheKey(
  projectId: string | undefined,
  projectDir: string,
  pageType: string,
): string {
  return `${projectId ?? projectDir}:${pageType}`;
}

// ============================================================================
// PROXY MANAGER CACHE KEYS
// ============================================================================

/**
 * Build a proxy manager cache key.
 * Format: {projectSlug}:{mode}:{releaseIdOrBranch}
 */
export function buildProxyManagerCacheKey(
  projectSlug: string,
  productionMode: boolean,
  releaseId: string | null,
  branch: string | null,
): string {
  if (productionMode) {
    return `${projectSlug}:production:${releaseId ?? "latest"}`;
  }
  return `${projectSlug}:preview:${branch ?? "main"}`;
}

// ============================================================================
// CACHE KEY UTILITIES
// ============================================================================

/**
 * Check if a cache key matches a specific project.
 */
export function isKeyForProject(key: string, projectId: string): boolean {
  const parts = key.split(":");
  // Check various formats where projectId is at different positions
  return parts.includes(projectId);
}

/**
 * Create a filter function for cache key clearing.
 */
export function createCacheKeyFilter(options: {
  projectId?: string;
  environment?: "production" | "preview";
  version?: string;
  prefix?: string;
}): (key: string) => boolean {
  return (key: string) => {
    const parts = key.split(":");
    if (parts.length < 2) return false;

    // Check prefix
    if (options.prefix && !key.startsWith(options.prefix)) return false;

    // Check projectId (can be at various positions)
    if (options.projectId && !parts.includes(options.projectId)) return false;

    // Check environment
    if (options.environment && !parts.includes(options.environment)) return false;

    // Check version
    if (options.version && !parts.includes(options.version)) return false;

    return true;
  };
}

/**
 * Get the current framework version used in cache keys.
 * Useful for debugging and cache inspection.
 */
export function getCacheKeyVersion(): string {
  return VERSION;
}
