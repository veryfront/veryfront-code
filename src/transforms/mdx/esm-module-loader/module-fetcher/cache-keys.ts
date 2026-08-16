/**
 * Cache key generation for module transforms.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/cache-keys
 */

import { buildMdxEsmPathCacheKey, buildMdxEsmTransformCacheKey } from "../cache-format.ts";
import { buildDependencyPinningCacheVariant } from "#veryfront/cache/keys/dependency-pinning.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";
import { hashString } from "#veryfront/cache/hash.ts";

export function getMdxModuleCacheVariant(
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
): string | undefined {
  const pinVariant = buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
  const externalIdentity = buildServerExternalPackagesIdentity(serverExternalPackages);
  if (!externalIdentity) return pinVariant;

  // MDX cache variants use the `on:` prefix to opt into the variant segment.
  const externalVariant = `on:server-externals-${hashString(externalIdentity)}`;
  return pinVariant ? `${pinVariant}:${externalVariant}` : externalVariant;
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
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
): string {
  return buildMdxEsmTransformCacheKey(
    projectId,
    contentSourceId,
    reactVersion,
    normalizedPath,
    contentHash,
    getMdxModuleCacheVariant(
      dependencyPinningCacheKey,
      moduleServerOrigin,
      serverExternalPackages,
    ),
  );
}

export function getVersionedPathCacheKey(
  normalizedPath: string,
  reactVersion: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
): string {
  return buildMdxEsmPathCacheKey(
    normalizedPath,
    reactVersion,
    getMdxModuleCacheVariant(
      dependencyPinningCacheKey,
      moduleServerOrigin,
      serverExternalPackages,
    ),
  );
}
