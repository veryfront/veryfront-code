/**
 * Cache key generation for module transforms.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/cache-keys
 */

import { buildMdxEsmPathCacheKey, buildMdxEsmTransformCacheKey } from "../cache-format.ts";

/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 * Always uses SSR mode suffix since this module loader is for server-side MDX rendering.
 * CRITICAL: The :ssr suffix is required to avoid cache collisions with browser-mode transforms
 * that use relative paths (../lib/utils.js) instead of absolute paths (/_vf_modules/lib/utils.js).
 */
export function getTransformCacheKey(
  projectId: string,
  contentSourceId: string,
  reactVersion: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return buildMdxEsmTransformCacheKey(
    projectId,
    contentSourceId,
    reactVersion,
    normalizedPath,
    contentHash,
  );
}

export function getVersionedPathCacheKey(
  normalizedPath: string,
  reactVersion: string,
  sourceContentHash?: string,
): string {
  return buildMdxEsmPathCacheKey(normalizedPath, reactVersion, sourceContentHash);
}
