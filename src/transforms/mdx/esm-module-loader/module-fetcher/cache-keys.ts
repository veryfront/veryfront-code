/**
 * Cache key generation for module transforms.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/cache-keys
 */

import {
  buildMdxEsmPathCacheKey,
  buildMdxEsmTransformCacheKey,
  MDX_MODULE_DEV_COMPILE_VARIANT,
} from "../cache-format.ts";
import { buildDependencyPinningCacheVariant } from "#veryfront/cache/keys/dependency-pinning.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";
import { hashString } from "#veryfront/cache/hash.ts";

export { MDX_MODULE_DEV_COMPILE_VARIANT };

/**
 * Build the cache-variant segment shared by every MDX module cache key.
 *
 * `dev` decides minification, tree shaking and inline sourcemaps, so a
 * development artifact must never be reachable from a production key. Only the
 * development compile mode adds a segment: production keeps the production
 * artifact on the unsegmented key, and the cache namespace is rolled alongside
 * this change so the legacy development-compiled entries written under that key
 * cannot be read back.
 */
export function getMdxModuleCacheVariant(
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  dev?: boolean,
): string | undefined {
  // MDX cache variants use the `on:` prefix to opt into the variant segment.
  const segments: string[] = [];
  const pinVariant = buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
  if (pinVariant) segments.push(pinVariant);

  const externalIdentity = buildServerExternalPackagesIdentity(serverExternalPackages);
  if (externalIdentity) segments.push(`on:server-externals-${hashString(externalIdentity)}`);

  if (dev) segments.push(MDX_MODULE_DEV_COMPILE_VARIANT);

  return segments.length > 0 ? segments.join(":") : undefined;
}

/**
 * Build cache key for transformed module.
 * Includes content hash so cache invalidates when source changes.
 * Always uses SSR mode suffix since this module loader is for server-side MDX rendering.
 * CRITICAL: The :ssr suffix is required to avoid cache collisions with browser-mode transforms
 * that use relative paths (../lib/utils.js) instead of absolute paths (/_vf_modules/lib/utils.js).
 * CRITICAL: `dev` must stay part of this key. It feeds the distributed transform
 * cache, so a shared entry that dropped the compile mode would serve
 * development-compiled modules to hosted production renders across instances.
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
  dev?: boolean,
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
      dev,
    ),
  );
}

export function getVersionedPathCacheKey(
  normalizedPath: string,
  reactVersion: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  dev?: boolean,
): string {
  return buildMdxEsmPathCacheKey(
    normalizedPath,
    reactVersion,
    getMdxModuleCacheVariant(
      dependencyPinningCacheKey,
      moduleServerOrigin,
      serverExternalPackages,
      dev,
    ),
  );
}
