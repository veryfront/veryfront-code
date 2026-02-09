/********************************************************************************
 * GitHub Adapter Cache Key Builders
 *
 * Cache key builders for GitHub content, directory, stat, tree,
 * and resolve operations.
 *
 * @module core/cache/keys/builders/github
 ********************************************************************************/

import { CacheKeyPrefix } from "../prefixes.ts";

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
