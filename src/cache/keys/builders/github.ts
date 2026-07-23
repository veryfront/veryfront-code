/********************************************************************************
 * GitHub Adapter Cache Key Builders
 *
 * Cache key builders for GitHub content, directory, stat, tree,
 * and resolve operations.
 *
 * @module core/cache/keys/builders/github
 ********************************************************************************/

import { CacheKeyPrefix } from "../prefixes.ts";
import { encodeCacheIdentitySegment } from "../source-identity.ts";

function encodeGitHubIdentity(value: string, label: string): string {
  // Tag empty fields explicitly. Prefixing non-empty values keeps the encoding
  // injective even when a valid Git path is literally "0".
  return value.length === 0 ? "0" : `1${encodeCacheIdentitySegment(value, label)}`;
}

/** Build a key for decoded GitHub file content. */
export function buildGitHubContentCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_CONTENT}:${encodeGitHubIdentity(ref, "ref")}:${
    encodeGitHubIdentity(path, "path")
  }`;
}

/** Build a key for raw GitHub file bytes. */
export function buildGitHubBytesCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_BYTES}:${encodeGitHubIdentity(ref, "ref")}:${
    encodeGitHubIdentity(path, "path")
  }`;
}

/** Build a key for a GitHub directory listing. */
export function buildGitHubDirCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_DIR}:${encodeGitHubIdentity(ref, "ref")}:${
    encodeGitHubIdentity(path, "path")
  }`;
}

/** Build a key for GitHub file metadata. */
export function buildGitHubStatCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_STAT}:${encodeGitHubIdentity(ref, "ref")}:${
    encodeGitHubIdentity(path, "path")
  }`;
}

/** Build a key for a GitHub repository tree. */
export function buildGitHubTreeCacheKey(repoId: string, ref: string): string {
  return `${CacheKeyPrefix.GITHUB_TREE}:${encodeGitHubIdentity(repoId, "repoId")}:${
    encodeGitHubIdentity(ref, "ref")
  }`;
}

/** Build a key for resolving a path at a GitHub reference. */
export function buildGitHubResolveCacheKey(ref: string, path: string): string {
  return `${CacheKeyPrefix.GITHUB_RESOLVE}:${encodeGitHubIdentity(ref, "ref")}:${
    encodeGitHubIdentity(path, "path")
  }`;
}
