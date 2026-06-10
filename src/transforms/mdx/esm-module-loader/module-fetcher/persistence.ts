/**
 * Final persistence phase for the MDX ESM module fetcher.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/persistence
 */

import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { cacheModule } from "./module-cache.ts";
import { writeDistributedCache } from "./distributed-cache.ts";

type CacheLocalModuleFn = typeof cacheModule;
type WriteDistributedCacheFn = typeof writeDistributedCache;
type DistributedCache = Parameters<WriteDistributedCacheFn>[0];

export interface PersistResolvedModuleInput {
  normalizedPath: string;
  moduleCode: string;
  esmCacheDir: string;
  pathCache: Map<string, string>;
  log: Logger;
  projectSlug: string;
  reactVersion?: string;
  distributedCacheWrite?: {
    distributedCache: DistributedCache;
    transformCacheKey: string;
    projectId: string;
    contentSourceId: string;
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

  if (input.distributedCacheWrite) {
    writeToDistributedCache(
      input.distributedCacheWrite.distributedCache,
      input.distributedCacheWrite.transformCacheKey,
      input.distributedCacheWrite.projectId,
      input.distributedCacheWrite.contentSourceId,
      input.moduleCode,
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
    input.moduleCode,
    input.esmCacheDir,
    input.pathCache,
    input.log,
    input.reactVersion,
  );
  input.log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] cacheModule DONE`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    cacheMs: (performance.now() - cacheStart).toFixed(1),
  });

  return finalCachedPath;
}
