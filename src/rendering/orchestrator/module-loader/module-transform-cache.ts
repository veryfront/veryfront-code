/**
 * Transform-cache and retry phase for the SSR module loader.
 *
 * @module rendering/orchestrator/module-loader/module-transform-cache
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { rendererLogger } from "#veryfront/utils";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import { transformToESM } from "#veryfront/transforms/esm-transform.ts";
import {
  generateCacheKey as generateTransformCacheKey,
  getOrComputeTransform,
  initializeTransformCache,
  setCachedTransformAsync,
  type TransformCachedEntryValidator,
} from "#veryfront/transforms/esm/transform-cache.ts";
import { validateCachedBundlesByManifestOrCode } from "#veryfront/transforms/esm/cached-bundle-validation.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { findMissingFrameworkBundlePaths } from "#veryfront/transforms/shared/framework-bundle-paths.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { TRANSFORM_DISTRIBUTED_TTL_SEC } from "#veryfront/utils/constants/cache.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import type { TransformProgressListener } from "#veryfront/transforms/progress.ts";

const logger = rendererLogger.component("module-loader");

/** Pattern to detect unresolved /_vf_modules/ imports that will fail at runtime. */
export const UNRESOLVED_VF_MODULES_RE = /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"']+)["']/;

export interface ModuleTransformCacheResult {
  code: string;
  cacheKey: string;
  contentHash: string;
}

interface TransformCacheResult {
  code: string;
  cacheHit: boolean;
  bundleManifestId?: string;
}

interface BundleValidationResult {
  valid: boolean;
  failedHashes: string[];
  reason?: string;
  source: string;
}

interface TransformOptions {
  projectId: string;
  dev: boolean;
  ssr: boolean;
  reactVersion?: string;
  onProgress?: TransformProgressListener;
}

interface PipelineResult {
  code: string;
}

export interface ModuleTransformCacheDeps {
  initializeTransformCache: typeof initializeTransformCache;
  getOrComputeTransform: (
    key: string,
    compute: (reportProgress?: TransformProgressListener) => Promise<string>,
    ttlSeconds: number,
    onProgress?: TransformProgressListener,
    signal?: AbortSignal,
    validateCachedEntry?: TransformCachedEntryValidator,
  ) => Promise<TransformCacheResult>;
  transformToESM: (
    code: string,
    filePath: string,
    projectDir: string,
    adapter: RuntimeAdapter,
    options: TransformOptions,
  ) => Promise<string>;
  validateCachedBundlesByManifestOrCode: (
    code: string,
    bundleManifestId: string | undefined,
    cacheDir: string,
  ) => Promise<BundleValidationResult>;
  findMissingFrameworkBundlePaths: (code: string) => Promise<string[]>;
  getHttpBundleCacheDir: typeof getHttpBundleCacheDir;
  setCachedTransformAsync: typeof setCachedTransformAsync;
  runPipeline: (
    code: string,
    filePath: string,
    projectDir: string,
    options: TransformOptions,
  ) => Promise<PipelineResult>;
}

const defaultDeps: ModuleTransformCacheDeps = {
  initializeTransformCache,
  getOrComputeTransform,
  transformToESM,
  validateCachedBundlesByManifestOrCode,
  findMissingFrameworkBundlePaths: (code) =>
    findMissingFrameworkBundlePaths(code, exists, {
      onError: (path, error) => {
        logger.error("Framework bundle validation error", {
          path,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    }),
  getHttpBundleCacheDir,
  setCachedTransformAsync,
  runPipeline: async (code, filePath, projectDir, options) => {
    const { runPipeline } = await import("#veryfront/transforms/pipeline/index.ts");
    return await runPipeline(code, filePath, projectDir, options);
  },
};

export interface TransformModuleCodeWithCacheInput {
  fileContent: string;
  filePath: string;
  projectDir: string;
  effectiveProjectId: string;
  mode: "development" | "production";
  adapter: RuntimeAdapter;
  reactVersion?: string;
  ttlSeconds?: number;
  onProgress?: TransformProgressListener;
  signal?: AbortSignal;
  deps?: ModuleTransformCacheDeps;
}

function createCachedTransformValidator(
  filePath: string,
  deps: ModuleTransformCacheDeps,
): TransformCachedEntryValidator {
  return async (entry) => {
    const [httpValidation, missingFrameworkBundles] = await Promise.all([
      deps.validateCachedBundlesByManifestOrCode(
        entry.code,
        entry.bundleManifestId,
        deps.getHttpBundleCacheDir(),
      ),
      deps.findMissingFrameworkBundlePaths(entry.code),
    ]);

    if (httpValidation.valid && missingFrameworkBundles.length === 0) {
      return true;
    }

    logger.warn("Cached transform dependency validation failed, re-transforming", {
      filePath,
      manifestId: entry.bundleManifestId?.slice(0, 12),
      failedHashes: httpValidation.failedHashes,
      reason: httpValidation.valid ? "framework_bundle_missing" : httpValidation.reason,
      source: httpValidation.valid ? "framework-bundles" : httpValidation.source,
      missingFrameworkBundleCount: missingFrameworkBundles.length,
      firstMissingFrameworkBundle: missingFrameworkBundles[0]?.split("/").pop(),
    });
    return false;
  };
}

/** Transform module source through the shared cache and stale-cache retry checks. */
export async function transformModuleCodeWithCache(
  input: TransformModuleCodeWithCacheInput,
): Promise<ModuleTransformCacheResult> {
  const deps = input.deps ?? defaultDeps;
  const ttlSeconds = input.ttlSeconds ?? TRANSFORM_DISTRIBUTED_TTL_SEC;
  const contentHash = hashCodeHex(input.fileContent);
  const scopedPath = `${input.effectiveProjectId}:${input.filePath}`;
  const reactVersion = input.reactVersion ?? REACT_DEFAULT_VERSION;
  const configHash = hashCodeHex(JSON.stringify([
    input.projectDir,
    input.mode,
    reactVersion,
  ]));
  const cacheKey = generateTransformCacheKey(
    scopedPath,
    contentHash,
    true,
    false,
    { configHash },
  );
  const transformOptions = {
    projectId: input.effectiveProjectId,
    dev: input.mode === "development",
    ssr: true,
    reactVersion,
    onProgress: input.onProgress,
  };

  await deps.initializeTransformCache();

  const transformResult = await deps.getOrComputeTransform(
    cacheKey,
    (reportProgress) => {
      logger.debug("Transform cache miss, transforming", { filePath: input.filePath });
      return deps.transformToESM(
        input.fileContent,
        input.filePath,
        input.projectDir,
        input.adapter,
        { ...transformOptions, onProgress: reportProgress },
      );
    },
    ttlSeconds,
    input.onProgress,
    input.signal,
    createCachedTransformValidator(input.filePath, deps),
  );

  input.signal?.throwIfAborted();

  let transformedCode = transformResult.code;

  // CRITICAL: Validate that no unresolved /_vf_modules/ imports remain after transform.
  // These imports should have been resolved to file:// paths by ssrVfModulesPlugin.
  // If they're still present, retry the transform bypassing all caches.
  if (UNRESOLVED_VF_MODULES_RE.test(transformedCode)) {
    const match = transformedCode.match(UNRESOLVED_VF_MODULES_RE);
    const unresolvedImport = match?.[1] || "unknown";
    logger.warn(
      "[ModuleLoader] Transform has unresolved _vf_modules import, retrying without cache",
      {
        filePath: input.filePath.slice(-60),
        unresolvedImport: unresolvedImport.slice(0, 80),
        cacheHit: transformResult.cacheHit,
      },
    );

    const pipelineResult = await deps.runPipeline(
      input.fileContent,
      input.filePath,
      input.projectDir,
      transformOptions,
    );
    transformedCode = pipelineResult.code;

    if (UNRESOLVED_VF_MODULES_RE.test(transformedCode)) {
      const retryMatch = transformedCode.match(UNRESOLVED_VF_MODULES_RE);
      logger.error("Transform still has unresolved _vf_modules after retry", {
        filePath: input.filePath.slice(-60),
        unresolvedImport: retryMatch?.[1]?.slice(0, 80) || "unknown",
        hint:
          "Check that framework sources exist in dist/framework-src/ and ssrVfModulesPlugin is running",
      });
    } else {
      deps.setCachedTransformAsync(
        cacheKey,
        transformedCode,
        hashCodeHex(transformedCode).slice(0, 16),
        ttlSeconds,
      ).catch((error) => {
        logger.debug("Failed to update cache after retry", {
          filePath: input.filePath,
          error,
        });
      });
    }
  }

  return { code: transformedCode, cacheKey, contentHash };
}
