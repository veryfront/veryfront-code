/**
 * Cache key generation for module transforms.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/cache-keys
 */

import { buildMdxEsmPathCacheKey, buildMdxEsmTransformCacheKey } from "../cache-format.ts";
import { buildDependencyPinningCacheVariant } from "#veryfront/cache/keys/dependency-pinning.ts";

export function getMdxModuleCacheVariant(
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string | undefined {
  return buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
}

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
  importMapFingerprint?: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  return buildMdxEsmTransformCacheKey(
    projectId,
    contentSourceId,
    reactVersion,
    normalizedPath,
    contentHash,
    importMapFingerprint,
    getMdxModuleCacheVariant(dependencyPinningCacheKey, moduleServerOrigin),
  );
}

export function getVersionedPathCacheKey(
  normalizedPath: string,
  reactVersion: string,
  sourceContentHash?: string,
  importMapFingerprint?: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string {
  return buildMdxEsmPathCacheKey(
    normalizedPath,
    reactVersion,
    sourceContentHash,
    importMapFingerprint,
    getMdxModuleCacheVariant(dependencyPinningCacheKey, moduleServerOrigin),
  );
}
