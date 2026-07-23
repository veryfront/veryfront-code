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
import { encodeCacheKeySegment } from "../segment-codec.ts";

const MAX_COMPOSED_CACHE_KEY_LENGTH = 32 * 1024;

function assertBoundedCacheKey(key: string, label: string): string {
  if (key.length === 0 || key.length > MAX_COMPOSED_CACHE_KEY_LENGTH) {
    throw new RangeError(`${label} must contain 1 to ${MAX_COMPOSED_CACHE_KEY_LENGTH} characters`);
  }
  return key;
}

export function buildSSRModuleProjectKey(projectDir: string, projectId: string): string {
  return assertBoundedCacheKey(
    `module-project:v2:${encodeCacheKeySegment(projectDir)}:${encodeCacheKeySegment(projectId)}`,
    "SSR module project key",
  );
}

export function buildModuleTransformCacheKey(
  projectKey: string,
  modulePath: string,
  isSSR: boolean,
): string {
  return assertBoundedCacheKey(
    `module-transform:v2:${encodeCacheKeySegment(projectKey)}:${
      encodeCacheKeySegment(modulePath)
    }:${isSSR ? "ssr" : "browser"}`,
    "Module transform cache key",
  );
}

export function buildModuleResolveCacheKey(specifier: string, referrer?: string): string {
  const referrerIdentity = referrer === undefined ? "undefined" : `value:${referrer}`;
  return assertBoundedCacheKey(
    `${CacheKeyPrefix.MODULE_RESOLVE}:v2:${encodeCacheKeySegment(specifier)}:${
      encodeCacheKeySegment(referrerIdentity)
    }`,
    "Module resolution cache key",
  );
}

export function buildSSRModuleCacheKey(
  version: string | number,
  projectId: string,
  filePath: string,
): string {
  return assertBoundedCacheKey(
    `${CacheKeyPrefix.SSR_VERSION}2:ssr:${encodeCacheKeySegment(String(version))}:${
      encodeCacheKeySegment(projectId)
    }:${encodeCacheKeySegment(filePath)}`,
    "SSR module cache key",
  );
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
 * Variable fields use injective base64url segments so the composed key remains
 * valid for API cache backends and cannot alias through delimiter injection.
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
  if (filePath.length === 0 || filePath.length > 16_384) {
    throw new RangeError("Transform cache file path must contain 1 to 16384 characters");
  }
  if (contentHash.length === 0 || contentHash.length > 1_024) {
    throw new RangeError("Transform cache content hash must contain 1 to 1024 characters");
  }
  if (options?.projectId !== undefined && options.projectId.length > 4_096) {
    throw new RangeError("Transform cache project ID is too large");
  }
  if (options?.depsHash !== undefined && options.depsHash.length > 1_024) {
    throw new RangeError("Transform cache dependency hash is too large");
  }
  if (options?.configHash !== undefined && options.configHash.length > 1_024) {
    throw new RangeError("Transform cache configuration hash is too large");
  }

  const target = ssr ? "ssr" : "browser";
  const projectId = options?.projectId ?? "";
  const normalizedPath = normalizeFilePath(filePath);
  const depsHash = options?.depsHash === undefined
    ? "none"
    : `value:${options.depsHash}`;
  const configHash = options?.configHash === undefined
    ? "none"
    : `value:${options.configHash}`;

  return assertBoundedCacheKey(
    `transform:v3:${encodeCacheKeySegment(String(VERSION))}:${
      encodeCacheKeySegment(projectId)
    }:${encodeCacheKeySegment(normalizedPath)}:${encodeCacheKeySegment(contentHash)}:${target}:${
      studioEmbed ? "studio" : "standard"
    }:${encodeCacheKeySegment(depsHash)}:${encodeCacheKeySegment(configHash)}`,
    "Transform cache key",
  );
}

export function buildContentHashCacheKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  const suffixIdentity = suffix === undefined ? "none" : `value:${suffix}`;
  return assertBoundedCacheKey(
    `content-hash:v2:${encodeCacheKeySegment(prefix)}:${encodeCacheKeySegment(filePath)}:${
      encodeCacheKeySegment(contentHash)
    }:${encodeCacheKeySegment(suffixIdentity)}`,
    "Content-hash cache key",
  );
}

export function buildBundleManifestCacheKey(manifestId: string): string {
  return `bm:${manifestId}`;
}
