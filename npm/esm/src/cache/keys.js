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
import { VERSION } from "../utils/version.js";
import { withSpan } from "../observability/tracing/otlp-setup.js";
import { SpanNames } from "../observability/tracing/span-names.js";
import { cacheRegistry, extractProjectIdFromKey, isKeyForProject, LRUCacheStore, MapCacheStore, registerLRUCache, registerMapCache, } from "./registry.js";
export { cacheRegistry, extractProjectIdFromKey, isKeyForProject, LRUCacheStore, MapCacheStore, registerLRUCache, registerMapCache, };
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
};
export function buildRenderCachePrefix(projectId, environment, releaseKey) {
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
export function computeContentSourceId(isLocalDev, environment, branch, releaseId) {
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
export function buildRenderCacheKey(cachePrefix, contentKey) {
    return `${cachePrefix}:${contentKey}`;
}
export function parseRenderCacheKey(cacheKey) {
    const parts = cacheKey.split(":");
    if (parts.length < 5)
        return null;
    const [projectId, environment, releaseKey, version, ...contentParts] = parts;
    if (!projectId || !environment || !releaseKey || !version)
        return null;
    return {
        projectId,
        environment,
        releaseKey,
        version,
        contentKey: contentParts.join(":"),
    };
}
export function buildConfigCacheKey(projectIdOrDir, isVirtualFilesystem) {
    const baseKey = isVirtualFilesystem
        ? `${CacheKeyPrefix.CONFIG_VIRTUAL}:${projectIdOrDir}`
        : projectIdOrDir;
    return `${baseKey}:${VERSION}`;
}
function getSourceTypeKey(sourceType) {
    return sourceType === "environment" ? "env" : sourceType;
}
function buildSourceQualifier(ctx) {
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
                throw new Error(`Missing releaseId for environment sourceType (project: ${ctx.projectSlug})`);
            }
            return `${ctx.environmentName}:${ctx.releaseId}`;
    }
}
function buildFileOperationPrefix(prefix, ctx, unknownKey) {
    if (!ctx)
        return unknownKey;
    return `${prefix}:${getSourceTypeKey(ctx.sourceType)}:${ctx.projectSlug}:${buildSourceQualifier(ctx)}`;
}
export function buildFileCacheKeyPrefix(ctx) {
    return buildFileOperationPrefix(CacheKeyPrefix.FILE, ctx, "file:unknown");
}
export function buildStatCacheKeyPrefix(ctx) {
    return buildFileOperationPrefix(CacheKeyPrefix.STAT, ctx, "stat:unknown");
}
export function buildDirCacheKeyPrefix(ctx) {
    return buildFileOperationPrefix(CacheKeyPrefix.DIR, ctx, "dir:unknown");
}
export function buildFileListCacheKey(ctx) {
    return buildFileOperationPrefix(CacheKeyPrefix.FILES, ctx, "files:unknown");
}
export function buildFileOperationCacheKey(prefix, path) {
    return `${prefix}:${path}`;
}
export function buildSSRModuleProjectKey(projectDir, projectId) {
    return `${projectDir}:${projectId}`;
}
export function buildModuleTransformCacheKey(projectKey, modulePath, isSSR) {
    return `${projectKey}:${modulePath}:${isSSR}`;
}
export function buildModuleResolveCacheKey(specifier, referrer) {
    return `${CacheKeyPrefix.MODULE_RESOLVE}:${specifier}:${referrer ?? "root"}`;
}
export function buildSSRModuleCacheKey(version, projectId, filePath) {
    return `${CacheKeyPrefix.SSR_VERSION}${version}:${projectId}:${filePath}`;
}
export function buildRedisSSRModuleKey(key) {
    return `${CacheKeyPrefix.SSR_MODULE}${key}`;
}
export function buildRedisFileCacheKey(key) {
    return `${CacheKeyPrefix.FILE_CACHE}${key}`;
}
export function buildRedisTransformKey(key) {
    return `${CacheKeyPrefix.TRANSFORM}${key}`;
}
/**
 * Build a transform cache key with full dependency tracking.
 *
 * Key format: v{VERSION}:{projectId}:{filePath}:{contentHash}:{depsHash}:{configHash}:{target}
 *
 * @param options - Cache key options
 */
export function buildTransformCacheKey(filePath, contentHash, ssr = false, studioEmbed = false, options) {
    const target = ssr ? "ssr" : "browser";
    const studioKey = studioEmbed ? ":studio" : "";
    const depsKey = options?.depsHash ? `:deps:${options.depsHash.slice(0, 8)}` : "";
    const configKey = options?.configHash ? `:cfg:${options.configHash.slice(0, 8)}` : "";
    const projectKey = options?.projectId ? `${options.projectId}:` : "";
    return `v${VERSION}:${projectKey}${filePath}:${contentHash}:${target}${studioKey}${depsKey}${configKey}`;
}
export function buildContentHashCacheKey(prefix, filePath, contentHash, suffix) {
    const base = `${prefix}:${filePath}:${contentHash}`;
    return suffix ? `${base}:${suffix}` : base;
}
export function buildComponentCacheKey(projectId, filePath, contentHash) {
    return `${CacheKeyPrefix.COMPONENT}:${projectId}:${filePath}:${contentHash}`;
}
export function buildLayoutComponentCacheKey(projectId, componentPath, hash, contentSourceId) {
    return `${CacheKeyPrefix.LAYOUT}:${projectId}:${contentSourceId}:${componentPath}:${hash}`;
}
export function buildGitHubContentCacheKey(ref, path) {
    return `${CacheKeyPrefix.GITHUB_CONTENT}:${ref}:${path}`;
}
export function buildGitHubBytesCacheKey(ref, path) {
    return `${CacheKeyPrefix.GITHUB_BYTES}:${ref}:${path}`;
}
export function buildGitHubDirCacheKey(ref, path) {
    return `${CacheKeyPrefix.GITHUB_DIR}:${ref}:${path}`;
}
export function buildGitHubStatCacheKey(ref, path) {
    return `${CacheKeyPrefix.GITHUB_STAT}:${ref}:${path}`;
}
export function buildGitHubTreeCacheKey(repoId, ref) {
    return `${CacheKeyPrefix.GITHUB_TREE}:${repoId}:${ref}`;
}
export function buildGitHubResolveCacheKey(ref, path) {
    return `${CacheKeyPrefix.GITHUB_RESOLVE}:${ref}:${path}`;
}
export function buildErrorPageCacheKey(projectId, projectDir, pageType) {
    return `${CacheKeyPrefix.ERROR_PAGE}:${projectId ?? projectDir}:${pageType}`;
}
export function buildProxyManagerCacheKey(projectSlug, productionMode, releaseId, branch) {
    const mode = productionMode ? "production" : "preview";
    if (productionMode && !releaseId) {
        throw new Error(`Missing releaseId in production for ${projectSlug}`);
    }
    const qualifier = productionMode ? releaseId : (branch ?? "main");
    return `${CacheKeyPrefix.PROXY}:${projectSlug}:${mode}:${qualifier}`;
}
export function createCacheKeyFilter(options) {
    return (key) => {
        const parts = key.split(":");
        if (parts.length < 2)
            return false;
        if (options.prefix && !key.startsWith(options.prefix))
            return false;
        if (options.projectId) {
            const projectId = options.projectId;
            const hasProjectId = parts[1] === projectId || (parts.length > 2 && parts[2] === projectId) ||
                parts.includes(projectId);
            if (!hasProjectId)
                return false;
        }
        if (options.environment && !parts.includes(options.environment))
            return false;
        if (options.version && !parts.includes(options.version))
            return false;
        return true;
    };
}
export function getCacheKeyVersion() {
    return VERSION;
}
export function getAllKeysForProject(projectId) {
    return cacheRegistry.getKeysForProject(projectId);
}
export function getAllKeysForProjectAsync(projectId, includeRedis = true) {
    return withSpan(SpanNames.CACHE_KEYS_GET_ALL_ASYNC, async (span) => {
        const result = await cacheRegistry.getAllKeysForProjectAsync(projectId, includeRedis);
        span?.setAttribute("cache.include_redis", includeRedis);
        return result;
    }, { "cache.project_id": projectId });
}
export function deleteAllKeysForProject(projectId) {
    return cacheRegistry.deleteKeysForProject(projectId);
}
export function deleteAllKeysForProjectAsync(projectId) {
    return withSpan(SpanNames.CACHE_KEYS_DELETE_ALL_ASYNC, async (span) => {
        const result = await cacheRegistry.deleteAllKeysForProjectAsync(projectId);
        span?.setAttribute("cache.memory.deleted", result.memoryDeleted);
        span?.setAttribute("cache.redis.deleted", result.redisDeleted);
        return result;
    }, { "cache.project_id": projectId });
}
export function buildBundleManifestCacheKey(manifestId) {
    return `bm:${manifestId}`;
}
