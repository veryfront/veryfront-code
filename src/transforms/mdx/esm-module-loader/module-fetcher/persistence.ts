/**
 * Final persistence phase for the MDX ESM module fetcher.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/persistence
 */

import type { Logger } from "#veryfront/utils";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { ensureFilenameDefaultExport } from "#veryfront/modules/loader-shared/filename-default-export.ts";
import { cacheModule } from "./module-cache.ts";
import { type MdxPrimaryPublicationPermit, writeDistributedCache } from "./distributed-cache.ts";
import type { AcknowledgedBundleManifestAuthority } from "../../../esm/http-cache.ts";

type CacheLocalModuleFn = typeof cacheModule;
type WriteDistributedCacheFn = typeof writeDistributedCache;

export interface PersistResolvedModuleInput {
  normalizedPath: string;
  moduleCode: string;
  esmCacheDir: string;
  pathCache: Map<string, string>;
  log: Logger;
  projectSlug: string;
  reactVersion?: string;
  sourceContentHash?: string;
  importMapFingerprint?: string;
  dependencyPinningCacheKey?: string;
  moduleServerOrigin?: string;
  distributedCachePublication?: {
    publicationPermit: MdxPrimaryPublicationPermit;
    projectId: string;
    contentSourceId: string;
    bundleManifestAuthority: AcknowledgedBundleManifestAuthority | null;
  };
  cacheLocalModule?: CacheLocalModuleFn;
  writeToDistributedCache?: WriteDistributedCacheFn;
}

/**
 * Persist fully resolved module code to distributed and local caches.
 */
export async function persistResolvedModule(
  input: PersistResolvedModuleInput,
): Promise<string | null> {
  const writeToDistributedCache = input.writeToDistributedCache ?? writeDistributedCache;
  const cacheLocalModule = input.cacheLocalModule ?? cacheModule;
  const moduleCode = ensureFilenameDefaultExport(input.normalizedPath, input.moduleCode);

  if (input.distributedCachePublication) {
    await writeToDistributedCache(
      input.distributedCachePublication.publicationPermit,
      input.distributedCachePublication.projectId,
      input.distributedCachePublication.contentSourceId,
      moduleCode,
      input.distributedCachePublication.bundleManifestAuthority,
      input.normalizedPath,
      input.log,
    );
  }

  input.log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule START`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
  });
  const cacheStart = performance.now();
  const finalCachedPath = await cacheLocalModule(
    input.normalizedPath,
    moduleCode,
    input.esmCacheDir,
    input.pathCache,
    input.log,
    input.reactVersion,
    input.sourceContentHash,
    input.importMapFingerprint,
    input.dependencyPinningCacheKey,
    input.moduleServerOrigin,
  );
  input.log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule DONE`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    cacheMs: (performance.now() - cacheStart).toFixed(1),
  });

  return finalCachedPath;
}
