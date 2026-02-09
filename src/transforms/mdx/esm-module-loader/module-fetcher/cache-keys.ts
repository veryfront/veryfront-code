/**
 * Cache key generation for module transforms.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/cache-keys
 */

import { VERSION } from "#veryfront/utils/version.ts";

/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 * Always uses SSR mode suffix since this module loader is for server-side MDX rendering.
 * CRITICAL: The :ssr suffix is required to avoid cache collisions with browser-mode transforms
 * that use relative paths (../lib/utils.js) instead of absolute paths (/_vf_modules/lib/utils.js).
 */
export function getTransformCacheKey(
  projectId: string,
  normalizedPath: string,
  contentHash: string,
): string {
  return `v${VERSION}:${projectId}:${normalizedPath}:${contentHash}:ssr`;
}

export function getVersionedPathCacheKey(normalizedPath: string): string {
  return `v${VERSION}:${normalizedPath}`;
}
