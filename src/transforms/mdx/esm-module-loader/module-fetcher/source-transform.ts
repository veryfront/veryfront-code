/**
 * Source-file transform phase for the MDX ESM module fetcher.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/source-transform
 */

import { cacheHttpImportsToLocal } from "../../../esm/http-cache.ts";
import { fingerprintImportMap } from "../../../esm/http-cache-helpers.ts";
import { loadImportMap } from "#veryfront/modules/import-map/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { transformToESM } from "../../../esm-transform.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import type { Logger } from "#veryfront/utils";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { frameworkSourceKeyOf } from "../resolution/module-path.ts";
import { rewriteDntImports, rewriteVeryfrontImports } from "./import-rewriter.ts";
import { transformFrameworkSource } from "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts";

type TransformToEsmFn = typeof transformToESM;
type LoadImportMapFn = typeof loadImportMap;
type CacheHttpImportsToLocalFn = typeof cacheHttpImportsToLocal;
type TransformFrameworkSourceFn = typeof transformFrameworkSource;
type SourceTransformLogger = Pick<Logger, "debug" | "error">;

export interface TransformResolvedModuleSourceInput {
  sourceCode: string;
  actualFilePath: string;
  projectDir: string;
  projectId: string;
  normalizedPath: string;
  projectSlug: string;
  /**
   * Compile the module in development mode. Production renders must leave this
   * false: development output is unminified, not tree-shaken and carries an
   * inline sourcemap that discloses the project source.
   */
  dev: boolean;
  reactVersion?: string;
  serverExternalPackages?: readonly string[];
  moduleServerOrigin?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  adapter: RuntimeAdapter;
  log: SourceTransformLogger;
  transformToEsm?: TransformToEsmFn;
  loadImportMap?: LoadImportMapFn;
  cacheHttpImportsToLocal?: CacheHttpImportsToLocalFn;
  transformFrameworkSource?: TransformFrameworkSourceFn;
}

function logTransformFailure(
  input: TransformResolvedModuleSourceInput,
  transformError: unknown,
): void {
  input.log.error(`${LOG_PREFIX_MDX_LOADER} Transform failed for module`, {
    normalizedPath: input.normalizedPath,
    actualFilePath: input.actualFilePath,
    sourceLength: input.sourceCode.length,
    sourcePreview: input.sourceCode.slice(0, 200),
    error: transformError instanceof Error ? transformError.message : String(transformError),
  });
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

  // Framework entries must keep their full dependency graph on one transformed
  // React runtime. The generic tenant transform can leave npm package file URLs
  // intact, which loads a second React instance during static MDX rendering.
  if (frameworkSourceKeyOf(input.normalizedPath) !== null) {
    const readImportMap = input.loadImportMap ?? loadImportMap;
    const importMap = await readImportMap(input.projectDir);
    const importMapFingerprint = await fingerprintImportMap(importMap);
    const transformFramework = input.transformFrameworkSource ?? transformFrameworkSource;
    try {
      return await transformFramework(
        input.sourceCode,
        input.actualFilePath,
        input.reactVersion ?? REACT_DEFAULT_VERSION,
        input.projectDir,
        createFileSystem(),
        undefined,
        importMap,
        importMapFingerprint,
      );
    } catch (transformError) {
      logTransformFailure(input, transformError);
      throw transformError;
    }
  }

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
        dev: input.dev,
        ssr: true,
        reactVersion: input.reactVersion,
        serverExternalPackages: input.serverExternalPackages,
        moduleServerOrigin: input.moduleServerOrigin,
        dependencyPinningCacheKey: input.dependencyPinningCacheKey,
        ...(input.dependencyPinningDependencies === undefined
          ? {}
          : { dependencyPinningDependencies: input.dependencyPinningDependencies }),
        ...(input.dependencyPinningSource === undefined
          ? {}
          : { dependencyPinningSource: input.dependencyPinningSource }),
      },
    );
  } catch (transformError) {
    logTransformFailure(input, transformError);
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
    serverExternalPackages: input.serverExternalPackages,
  });

  return cacheResult.code;
}
