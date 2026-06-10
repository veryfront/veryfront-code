/**
 * Unresolved module HTTP fallback phase for the MDX ESM module fetcher.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/http-fallback
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { buildMissingModuleError } from "../missing-module.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";
import { cacheModule } from "./module-cache.ts";

type FetchModuleViaHttpFn = typeof fetchModuleViaHTTP;
type CacheLocalModuleFn = typeof cacheModule;

export interface ResolveUnresolvedModuleViaHttpFallbackInput {
  normalizedPath: string;
  parentModulePath?: string;
  adapter: RuntimeAdapter;
  fetchAndCacheModule: (path: string, parent?: string) => Promise<string | null>;
  log: Logger;
  projectSlug: string;
  isLocalProject?: boolean;
  strictMissingModules?: boolean;
  esmCacheDir: string;
  pathCache: Map<string, string>;
  reactVersion?: string;
  fetchViaHttp?: FetchModuleViaHttpFn;
  cacheLocalModule?: CacheLocalModuleFn;
}

/**
 * Resolve an unresolved filesystem module through the local HTTP fallback.
 */
export async function resolveUnresolvedModuleViaHttpFallback(
  input: ResolveUnresolvedModuleViaHttpFallbackInput,
): Promise<string | null> {
  const fetchViaHttp = input.fetchViaHttp ?? fetchModuleViaHTTP;
  const cacheLocalModule = input.cacheLocalModule ?? cacheModule;

  const moduleCode = await fetchViaHttp(
    input.normalizedPath,
    input.adapter,
    input.fetchAndCacheModule,
    input.log,
    input.projectSlug,
    input.isLocalProject,
  );

  if (moduleCode) {
    return await cacheLocalModule(
      input.normalizedPath,
      moduleCode,
      input.esmCacheDir,
      input.pathCache,
      input.log,
      input.reactVersion,
    );
  }

  if (input.strictMissingModules ?? true) {
    throw buildMissingModuleError({
      modulePath: input.normalizedPath,
      importer: input.parentModulePath,
      projectSlug: input.projectSlug,
    });
  }

  return null;
}
