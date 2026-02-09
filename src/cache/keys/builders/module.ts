/********************************************************************************
 * Module/SSR/Transform Cache Key Builders
 *
 * Cache key builders for module resolution, SSR modules, Redis keys,
 * and transform caching with dependency tracking.
 *
 * @module core/cache/keys/builders/module
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { CacheKeyPrefix } from "../prefixes.ts";
import { normalizeFilePath } from "../utils.ts";

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

/**
 * Build a transform cache key with full dependency tracking.
 *
 * Key format: v{VERSION}:{projectId}:{filePath}:{contentHash}:{depsHash}:{configHash}:{target}
 *
 * @param filePath - File path to build cache key for
 * @param contentHash - Hash of the file content
 * @param ssr - Whether this is an SSR transform
 * @param studioEmbed - Whether this is a studio embed transform
 * @param options - Additional options for dependency/config tracking
 */
export function buildTransformCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
  options?: {
    depsHash?: string;
    configHash?: string;
    projectId?: string;
  },
): string {
  const target = ssr ? "ssr" : "browser";
  const studioKey = studioEmbed ? ":studio" : "";
  const depsKey = options?.depsHash ? `:deps:${options.depsHash.slice(0, 8)}` : "";
  const configKey = options?.configHash ? `:cfg:${options.configHash.slice(0, 8)}` : "";
  const projectKey = options?.projectId ? `${options.projectId}:` : "";
  const normalizedPath = normalizeFilePath(filePath);

  return `v${VERSION}:${projectKey}${normalizedPath}:${contentHash}:${target}${studioKey}${depsKey}${configKey}`;
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

export function buildBundleManifestCacheKey(manifestId: string): string {
  return `bm:${manifestId}`;
}
