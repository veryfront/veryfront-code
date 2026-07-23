/********************************************************************************
 * Module/SSR/Transform Cache Key Builders
 *
 * Cache key builders for module resolution, SSR modules, Redis keys,
 * and transform caching with dependency tracking.
 *
 * @module core/cache/keys/builders/module
 ********************************************************************************/

import { VERSION } from "#veryfront/utils/version.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { CacheKeyPrefix } from "../prefixes.ts";
import { encodeCacheIdentitySegment } from "../source-identity.ts";
import { normalizeFilePath } from "../utils.ts";

const MAX_POD_MODULE_CACHE_KEY_LENGTH = 65_536;
// Two maximally percent-encoded 4 KiB identity fields plus structural delimiters.
const MAX_MODULE_RESOLVE_CACHE_KEY_LENGTH = 80 * 1024;

function encodeContentHashKeyField(value: string, label: string): string {
  encodeCacheIdentitySegment(value, label);
  return value.replaceAll("%", "%25").replaceAll(":", "%3A");
}

export interface ParsedModuleResolveCacheKey {
  readonly specifier: string;
  readonly referrer?: string;
}

/** Build the canonical key used by the pod-level transformed-module cache. */
export function buildPodModuleCacheKey(
  filePath: string,
  projectId?: string,
  projectDir?: string,
  contentSourceId?: string,
  reactVersion?: string,
  mode?: "development" | "production",
): string {
  const key = JSON.stringify([
    projectId ?? projectDir ?? "default",
    contentSourceId ?? "default",
    reactVersion ?? REACT_DEFAULT_VERSION,
    mode ?? "default",
    filePath,
  ]);
  if (key.length > MAX_POD_MODULE_CACHE_KEY_LENGTH) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Pod module cache key exceeds the supported size",
    });
  }
  return key;
}

/** Read the exact project identity from a canonical pod module cache key. */
export function getPodModuleCacheProjectId(key: string): string | null {
  if (
    typeof key !== "string" || key.length === 0 ||
    key.length > MAX_POD_MODULE_CACHE_KEY_LENGTH || key[0] !== "["
  ) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(key);
    if (
      !Array.isArray(value) || value.length !== 5 ||
      value.some((field) => typeof field !== "string")
    ) {
      return null;
    }
    return value[0];
  } catch {
    return null;
  }
}

export function buildSSRModuleProjectKey(projectDir: string, projectId: string): string {
  return `${encodeCacheIdentitySegment(projectDir, "projectDir")}:${
    encodeCacheIdentitySegment(projectId, "projectId")
  }`;
}

/** Build a project-isolated key for one transformed module. */
export function buildModuleTransformCacheKey(
  projectKey: string,
  modulePath: string,
  isSSR: boolean,
): string {
  return `${encodeCacheIdentitySegment(projectKey, "projectKey")}:${
    encodeCacheIdentitySegment(normalizeFilePath(modulePath), "modulePath")
  }:${isSSR}`;
}

/** Build the canonical key for a module resolution result. */
export function buildModuleResolveCacheKey(specifier: string, referrer?: string): string {
  const encodedSpecifier = encodeCacheIdentitySegment(specifier, "specifier");
  const referrerIdentity = referrer === undefined
    ? "root"
    : `ref:${encodeCacheIdentitySegment(referrer, "referrer")}`;
  const key = `${CacheKeyPrefix.MODULE_RESOLVE}:${encodedSpecifier}:${referrerIdentity}`;
  if (key.length > MAX_MODULE_RESOLVE_CACHE_KEY_LENGTH) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Module resolve cache key exceeds the supported size",
    });
  }
  return key;
}

/** Parse a canonical module-resolution key without accepting alternate encodings. */
export function parseModuleResolveCacheKey(key: string): ParsedModuleResolveCacheKey | null {
  if (
    typeof key !== "string" || key.length === 0 ||
    key.length > MAX_MODULE_RESOLVE_CACHE_KEY_LENGTH
  ) {
    return null;
  }

  const parts = key.split(":");
  const isRootKey = parts.length === 3 && parts[2] === "root";
  const isReferrerKey = parts.length === 4 && parts[2] === "ref";
  if (parts[0] !== CacheKeyPrefix.MODULE_RESOLVE || (!isRootKey && !isReferrerKey)) {
    return null;
  }

  const decodeCanonicalSegment = (encoded: string | undefined, label: string): string | null => {
    if (!encoded) return null;
    try {
      const decoded = decodeURIComponent(encoded);
      return encodeCacheIdentitySegment(decoded, label) === encoded ? decoded : null;
    } catch {
      return null;
    }
  };

  const specifier = decodeCanonicalSegment(parts[1], "specifier");
  if (specifier === null) return null;
  if (isRootKey) return Object.freeze({ specifier });

  const referrer = decodeCanonicalSegment(parts[3], "referrer");
  return referrer === null ? null : Object.freeze({ specifier, referrer });
}

/** Match one canonical resolution key to its exact decoded module specifier. */
export function isModuleResolveCacheKeyForSpecifier(key: string, specifier: string): boolean {
  return parseModuleResolveCacheKey(key)?.specifier === specifier;
}

export function buildSSRModuleCacheKey(
  version: string | number,
  projectId: string,
  filePath: string,
): string {
  return `${CacheKeyPrefix.SSR_VERSION}${encodeCacheIdentitySegment(String(version), "version")}:${
    encodeCacheIdentitySegment(projectId, "projectId")
  }:${filePath}`;
}

/** Add the Redis SSR module namespace to a cache key. */
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
  const depsKey = options?.depsHash
    ? `:deps:${encodeCacheIdentitySegment(options.depsHash, "depsHash")}`
    : "";
  const configKey = options?.configHash
    ? `:cfg:${encodeCacheIdentitySegment(options.configHash, "configHash")}`
    : "";
  const projectKey = options?.projectId
    ? `${encodeCacheIdentitySegment(options.projectId, "projectId")}:`
    : "";
  const normalizedPath = encodeCacheIdentitySegment(normalizeFilePath(filePath), "filePath");
  const encodedContentHash = encodeCacheIdentitySegment(contentHash, "contentHash");

  return `v${VERSION}:${projectKey}${normalizedPath}:${encodedContentHash}:${target}${studioKey}${depsKey}${configKey}`;
}

export function buildContentHashCacheKey(
  prefix: string,
  filePath: string,
  contentHash: string,
  suffix?: string,
): string {
  const base = `${encodeContentHashKeyField(prefix, "prefix")}:${
    encodeContentHashKeyField(filePath, "filePath")
  }:${encodeContentHashKeyField(contentHash, "contentHash")}`;
  return suffix ? `${base}:${encodeContentHashKeyField(suffix, "suffix")}` : base;
}

export function buildBundleManifestCacheKey(manifestId: string): string {
  return `bm:${encodeCacheIdentitySegment(manifestId, "manifestId")}`;
}
