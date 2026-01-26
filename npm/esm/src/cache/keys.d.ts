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
import { cacheRegistry, type CacheStore, extractProjectIdFromKey, isKeyForProject, LRUCacheStore, MapCacheStore, registerLRUCache, registerMapCache } from "./registry.js";
export { cacheRegistry, type CacheStore, extractProjectIdFromKey, isKeyForProject, LRUCacheStore, MapCacheStore, registerLRUCache, registerMapCache, };
export declare const CacheKeyPrefix: {
    readonly SSR_MODULE: "veryfront:ssr-module:";
    readonly FILE_CACHE: "veryfront:file-cache:";
    readonly TRANSFORM: "veryfront:transform:";
    readonly CONFIG: "config";
    readonly CONFIG_VIRTUAL: "vf";
    readonly FILE: "file";
    readonly STAT: "stat";
    readonly DIR: "dir";
    readonly FILES: "files";
    readonly GITHUB_CONTENT: "github:content";
    readonly GITHUB_BYTES: "github:bytes";
    readonly GITHUB_DIR: "github:dir";
    readonly GITHUB_STAT: "github:stat";
    readonly GITHUB_TREE: "github:tree";
    readonly GITHUB_RESOLVE: "github:resolve";
    readonly MODULE_RESOLVE: "resolve";
    readonly MODULE_PATH: "veryfront";
    readonly SSR_VERSION: "v";
    readonly COMPONENT: "component";
    readonly LAYOUT: "layout";
    readonly ERROR_PAGE: "error";
    readonly PROXY: "proxy";
    readonly PROJECT: "project";
    readonly GLOBALS_CSS: "globals";
};
export type FileSourceType = "branch" | "release" | "environment";
export declare function buildRenderCachePrefix(projectId: string, environment: "preview" | "production", releaseKey: string): string;
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
export declare function computeContentSourceId(isLocalDev: boolean, environment: "preview" | "production", branch: string | null | undefined, releaseId: string | null | undefined): string;
export declare function buildRenderCacheKey(cachePrefix: string, contentKey: string): string;
export declare function parseRenderCacheKey(cacheKey: string): {
    projectId: string;
    environment: string;
    releaseKey: string;
    version: string;
    contentKey: string;
} | null;
export declare function buildConfigCacheKey(projectIdOrDir: string, isVirtualFilesystem: boolean): string;
export interface FileOperationContext {
    sourceType: FileSourceType;
    projectSlug: string;
    branch?: string | null;
    releaseId?: string | null;
    environmentName?: string | null;
}
export declare function buildFileCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string;
export declare function buildStatCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string;
export declare function buildDirCacheKeyPrefix(ctx: FileOperationContext | null | undefined): string;
export declare function buildFileListCacheKey(ctx: FileOperationContext | null | undefined): string;
export declare function buildFileOperationCacheKey(prefix: string, path: string): string;
export declare function buildSSRModuleProjectKey(projectDir: string, projectId: string): string;
export declare function buildModuleTransformCacheKey(projectKey: string, modulePath: string, isSSR: boolean): string;
export declare function buildModuleResolveCacheKey(specifier: string, referrer?: string): string;
export declare function buildSSRModuleCacheKey(version: string | number, projectId: string, filePath: string): string;
export declare function buildRedisSSRModuleKey(key: string): string;
export declare function buildRedisFileCacheKey(key: string): string;
export declare function buildRedisTransformKey(key: string): string;
export declare function buildTransformCacheKey(filePath: string, contentHash: string, ssr?: boolean, studioEmbed?: boolean): string;
export declare function buildContentHashCacheKey(prefix: string, filePath: string, contentHash: string, suffix?: string): string;
export declare function buildComponentCacheKey(projectId: string, filePath: string, contentHash: string): string;
export declare function buildLayoutComponentCacheKey(projectId: string, componentPath: string, hash: string, contentSourceId: string): string;
export declare function buildGitHubContentCacheKey(ref: string, path: string): string;
export declare function buildGitHubBytesCacheKey(ref: string, path: string): string;
export declare function buildGitHubDirCacheKey(ref: string, path: string): string;
export declare function buildGitHubStatCacheKey(ref: string, path: string): string;
export declare function buildGitHubTreeCacheKey(repoId: string, ref: string): string;
export declare function buildGitHubResolveCacheKey(ref: string, path: string): string;
export declare function buildErrorPageCacheKey(projectId: string | undefined, projectDir: string, pageType: string): string;
export declare function buildProxyManagerCacheKey(projectSlug: string, productionMode: boolean, releaseId: string | null, branch: string | null): string;
export declare function createCacheKeyFilter(options: {
    projectId?: string;
    environment?: "production" | "preview";
    version?: string;
    prefix?: string;
}): (key: string) => boolean;
export declare function getCacheKeyVersion(): string;
export declare function getAllKeysForProject(projectId: string): Map<string, string[]>;
export declare function getAllKeysForProjectAsync(projectId: string, includeRedis?: boolean): Promise<{
    memory: Map<string, string[]>;
    redis: Map<string, string[]>;
}>;
export declare function deleteAllKeysForProject(projectId: string): number;
export declare function deleteAllKeysForProjectAsync(projectId: string): Promise<{
    memoryDeleted: number;
    redisDeleted: number;
}>;
//# sourceMappingURL=keys.d.ts.map