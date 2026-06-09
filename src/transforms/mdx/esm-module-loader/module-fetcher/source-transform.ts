/**
 * Source-file transform phase for the MDX ESM module fetcher.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/source-transform
 */

import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { transformToESM } from "../../../esm-transform.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";

type TransformToEsmFn = typeof transformToESM;
type LoadImportMapFn = typeof loadImportMap;
type CacheHttpImportsToLocalFn = typeof cacheHttpImportsToLocal;
type SourceTransformLogger = Pick<Logger, "debug" | "error">;

export interface TransformResolvedModuleSourceInput {
  sourceCode: string;
  actualFilePath: string;
  projectDir: string;
  projectId: string;
  normalizedPath: string;
  projectSlug: string;
  reactVersion?: string;
  adapter: RuntimeAdapter;
  log: SourceTransformLogger;
  transformToEsm?: TransformToEsmFn;
  loadImportMap?: LoadImportMapFn;
  cacheHttpImportsToLocal?: CacheHttpImportsToLocalFn;
}

/**
 * Transform a resolved source file into cache-safe ESM module code.
 */
export async function transformResolvedModuleSource(
  input: TransformResolvedModuleSourceInput,
): Promise<string> {
  input.log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM START`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    actualFilePath: input.actualFilePath,
    sourceLength: input.sourceCode.length,
  });

  const preprocessedSource = rewriteVeryfrontImports(input.sourceCode);
  const transform = input.transformToEsm ?? transformToESM;
  const transformStart = performance.now();
  let moduleCode: string;
  try {
    moduleCode = await transform(
      preprocessedSource,
      input.actualFilePath,
      input.projectDir,
      input.adapter,
      {
        projectId: input.projectId,
        dev: true,
        ssr: true,
        reactVersion: input.reactVersion,
      },
    );
  } catch (transformError) {
    input.log.error(`${LOG_PREFIX_MDX_LOADER} Transform failed for module`, {
      normalizedPath: input.normalizedPath,
      actualFilePath: input.actualFilePath,
      sourceLength: input.sourceCode.length,
      sourcePreview: input.sourceCode.slice(0, 200),
      error: transformError instanceof Error ? transformError.message : String(transformError),
    });
    throw transformError;
  }

  input.log.debug(`${LOG_PREFIX_MDX_LOADER} [fetchAndCacheModule] transformToESM DONE`, {
    projectSlug: input.projectSlug,
    normalizedPath: input.normalizedPath,
    transformMs: (performance.now() - transformStart).toFixed(1),
    outputLength: moduleCode.length,
  });

  moduleCode = await rewriteDntImports(moduleCode, input.actualFilePath);

  input.log.debug(`${LOG_PREFIX_MDX_LOADER} Caching HTTP imports to local files`, {
    normalizedPath: input.normalizedPath,
  });
  const readImportMap = input.loadImportMap ?? loadImportMap;
  const cacheHttpImports = input.cacheHttpImportsToLocal ?? cacheHttpImportsToLocal;
  const importMap = await readImportMap(input.projectDir);
  const cacheResult = await cacheHttpImports(moduleCode, {
    cacheDir: getHttpBundleCacheDir(),
    importMap,
    reactVersion: input.reactVersion,
  });

  return cacheResult.code;
}
