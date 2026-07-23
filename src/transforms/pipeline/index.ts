/**
 * Transforms Pipeline
 *
 * @module transforms/pipeline
 */

import {
  generateCacheKey,
  getCachedTransformAsync,
  setCachedTransformAsync,
} from "../esm/transform-cache.ts";
import { rendererLogger } from "#veryfront/utils";
import { createTransformContext, formatTimingLog, recordStageTiming } from "./context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type {
  PipelineConfig,
  TransformOptions,
  TransformPlugin,
  TransformResult,
} from "./types.ts";
import {
  browserNodeBuiltinImportsPlugin,
  browserServerExportsStripPlugin,
  compilePlugin,
  cssStripPlugin,
  finalizePlugin,
  parsePlugin,
  resolveImportsPlugin,
  ssrHttpCachePlugin,
  ssrHttpStubPlugin,
  ssrVfModulesPlugin,
} from "./stages/index.ts";
import { exists } from "#veryfront/platform/compat/fs.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { validateCachedBundlesByManifestOrCode } from "../esm/cached-bundle-validation.ts";
import { extractFrameworkBundlePaths } from "../shared/framework-bundle-paths.ts";
import { createPipelineReadFile } from "./read-file.ts";
import { computeDependencyCacheIdentity } from "./dependency-cache-identity.ts";
import {
  computePipelineConfigIdentity,
  fingerprintPipelineImportMap,
  getCustomPluginCacheIdentity,
  snapshotImportMap,
} from "./cache-identity.ts";
import { loadImportMap as loadProjectImportMap } from "#veryfront/modules/import-map/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

const SSR_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  cssStripPlugin, // Strip CSS imports before they hit import resolution
  resolveImportsPlugin, // Unified import resolution
  ssrVfModulesPlugin, // Resolve /_vf_modules/ to framework files with React transforms
  ssrHttpStubPlugin,
  ssrHttpCachePlugin,
  finalizePlugin,
];

const BROWSER_PIPELINE: TransformPlugin[] = [
  parsePlugin,
  compilePlugin,
  cssStripPlugin, // Strip CSS imports before they hit import resolution
  browserServerExportsStripPlugin, // Drop server-only hooks + their now-unused imports
  browserNodeBuiltinImportsPlugin, // node:* named imports -> namespace + destructure
  resolveImportsPlugin, // Unified import resolution
  finalizePlugin,
];

/**
 * Pattern to detect unresolved /_vf_modules/_veryfront/ imports in code.
 * These should have been transformed to file:// paths by ssrVfModulesPlugin.
 * If they're still present, the cache is stale/corrupted.
 *
 * Handles multiple cases:
 * - from "/_vf_modules/_veryfront/..."
 * - from "_vf_modules/_veryfront/..."
 * - from "file:///_vf_modules/_veryfront/..." (Deno adds file:// prefix to raw paths)
 */
const UNRESOLVED_VF_MODULES_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/_veryfront\/[^"']+)["']/;

/**
 * Validate that framework bundles referenced in cached code exist locally.
 * Also validates that there are no unresolved /_vf_modules/ imports.
 * Returns true if all bundles exist, false if any are missing or unresolved.
 */
async function validateFrameworkBundles(
  code: string,
  cacheKey: string,
): Promise<boolean> {
  // First, check for unresolved /_vf_modules/_veryfront/ imports.
  // These should have been transformed to file:// paths.
  // If they're still present, the cache is stale from a failed transform.
  if (UNRESOLVED_VF_MODULES_PATTERN.test(code)) {
    const match = code.match(UNRESOLVED_VF_MODULES_PATTERN);
    logger.warn("Cache contains unresolved _vf_modules import, invalidating", {
      cacheKey: cacheKey.slice(-40),
      unresolvedImport: match?.[1]?.slice(0, 60),
    });
    return false;
  }

  const bundlePaths = extractFrameworkBundlePaths(code);
  if (bundlePaths.length === 0) return true;

  const missing: string[] = [];
  for (const path of bundlePaths) {
    try {
      if (!(await exists(path))) {
        missing.push(path);
      }
    } catch (error) {
      rendererLogger.error("Framework bundle validation error", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      missing.push(path);
    }
  }

  if (missing.length === 0) return true;

  logger.debug("Framework bundle validation failed", {
    cacheKey: cacheKey.slice(-40),
    failedCount: missing.length,
    totalBundles: bundlePaths.length,
    firstMissing: missing[0]?.split("/").pop(),
  });
  return false;
}

/**
 * Validate that HTTP bundles referenced in cached code exist locally.
 * If bundles are missing, try to recover them from distributed cache.
 * Returns true if all bundles are valid/recovered, false if cache should be invalidated.
 */
async function validateCachedBundles(
  code: string,
  bundleManifestId: string | undefined,
  cacheKey: string,
): Promise<boolean> {
  const cacheDir = getHttpBundleCacheDir();
  const validation = await validateCachedBundlesByManifestOrCode(code, bundleManifestId, cacheDir);
  if (validation.valid) return true;

  logger.debug("Cached HTTP bundle validation failed", {
    cacheKey: cacheKey.slice(-40),
    manifestId: bundleManifestId?.slice(0, 12),
    failedCount: validation.failedHashes.length,
    reason: validation.reason,
    source: validation.source,
  });
  return false;
}

export function runPipeline(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
  config?: PipelineConfig,
): Promise<TransformResult> {
  const fileName = filePath.split("/").pop() || filePath;

  return withSpan(
    "transform.pipeline",
    async () => {
      const transformStart = performance.now();

      const ctx = await createTransformContext(source, filePath, projectDir, options);
      ctx.debug = config?.debug ?? false;

      const basePipeline = options.ssr ? SSR_PIPELINE : BROWSER_PIPELINE;
      const pipeline = config?.plugins
        ? [...basePipeline, ...config.plugins].sort((a, b) => a.stage - b.stage)
        : basePipeline;
      const pluginIdentity = getCustomPluginCacheIdentity(config?.plugins);

      let importMapFingerprint: string | undefined;
      if (options.ssr) {
        const rawImportMap = await (options.loadImportMap?.() ?? loadProjectImportMap(projectDir));
        ctx.importMap = snapshotImportMap(rawImportMap);
        // Keep the metadata entry during the transition for internal consumers
        // that have not yet adopted the typed context field.
        ctx.metadata.set("importMap", ctx.importMap);
        importMapFingerprint = await fingerprintPipelineImportMap(ctx.importMap);
        ctx.importMapFingerprint = importMapFingerprint;
      }

      const configHash = await computePipelineConfigIdentity({
        reactVersion: ctx.reactVersion,
        jsxImportSource: ctx.jsxImportSource,
        studioEmbed: ctx.studioEmbed ?? false,
        dev: ctx.dev,
        ssr: options.ssr ?? false,
        projectDir,
        moduleServerUrl: ctx.moduleServerUrl,
        vendorBundleHash: ctx.vendorBundleHash,
        apiBaseUrl: ctx.apiBaseUrl,
        importMapFingerprint,
        customPlugins: pluginIdentity.cacheable ? pluginIdentity.identity : [],
      });

      const dependencyIdentity = await computeDependencyCacheIdentity(
        filePath,
        projectDir,
        options.readFile,
        options.dependencyHashCache,
        ctx.importMap,
        importMapFingerprint,
      );

      if (!dependencyIdentity.cacheable) {
        const { error } = dependencyIdentity;
        logger.warn("Dependency hash computation failed; bypassing transform cache", {
          file: filePath.slice(-60),
          errorName: error instanceof Error ? error.name : typeof error,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      if (!pluginIdentity.cacheable) {
        logger.warn("Custom transform plugin has no stable identity; bypassing transform cache", {
          file: filePath.slice(-60),
          reason: pluginIdentity.reason,
        });
      }

      const cacheKey = dependencyIdentity.cacheable && pluginIdentity.cacheable
        ? generateCacheKey(
          filePath,
          ctx.contentHash,
          options.ssr ?? false,
          options.studioEmbed ?? false,
          { depsHash: dependencyIdentity.depsHash, configHash, projectId: options.projectId },
        )
        : undefined;

      const cached = cacheKey === undefined ? undefined : await getCachedTransformAsync(cacheKey);
      if (cached && cacheKey !== undefined) {
        // For SSR transforms, validate bundles exist before returning cached code
        if (options.ssr) {
          const httpBundlesValid = await validateCachedBundles(
            cached.code,
            cached.bundleManifestId,
            cacheKey,
          );

          // Also validate framework bundles (SSR VF modules) exist locally.
          // These are pod-local files that won't exist after pod restart/migration.
          const frameworkBundlesValid = await validateFrameworkBundles(
            cached.code,
            cacheKey,
          );

          if (!httpBundlesValid) {
            logger.debug("Cache invalidated due to missing HTTP bundles", {
              file: filePath.slice(-60),
            });
            // Fall through to re-run the pipeline
          } else if (!frameworkBundlesValid) {
            logger.debug("Cache invalidated due to missing framework bundles", {
              file: filePath.slice(-60),
            });
            // Fall through to re-run the pipeline
          } else {
            return {
              code: cached.code,
              contentHash: ctx.contentHash,
              timing: new Map(),
              totalMs: performance.now() - transformStart,
              cached: true,
            };
          }
        } else {
          return {
            code: cached.code,
            contentHash: ctx.contentHash,
            timing: new Map(),
            totalMs: performance.now() - transformStart,
            cached: true,
          };
        }
      }

      for (const plugin of pipeline) {
        if (plugin.condition?.(ctx) === false) continue;

        const stageStart = performance.now();

        try {
          ctx.code = await withSpan(
            `transform.stage.${plugin.name}`,
            async () => plugin.transform(ctx),
            { "transform.stage": plugin.name, "transform.stage_order": plugin.stage },
          );
        } catch (error) {
          logger.error(`[PIPELINE:${plugin.name}] Stage failed`, {
            file: filePath.slice(-60),
            stage: plugin.name,
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }

        recordStageTiming(ctx, plugin.stage, stageStart);
      }

      // Store the bundleManifestId from ssrHttpCachePlugin for future cache validation
      const bundleManifestId = ctx.metadata.get("bundleManifestId") as string | undefined;
      if (cacheKey !== undefined) {
        try {
          await setCachedTransformAsync(
            cacheKey,
            ctx.code,
            ctx.contentHash,
            undefined,
            bundleManifestId,
          );
        } catch (error) {
          logger.warn("Failed to cache transform", {
            file: filePath.slice(-60),
            errorName: error instanceof Error ? error.name : typeof error,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const totalMs = performance.now() - transformStart;

      if (ctx.debug) {
        logger.debug("Transform complete", formatTimingLog(ctx));
      }

      return {
        code: ctx.code,
        contentHash: ctx.contentHash,
        timing: ctx.timing,
        totalMs,
        cached: false,
      };
    },
    {
      "transform.file": fileName,
      "transform.target": options.ssr ? "ssr" : "browser",
      "transform.studio_embed": options.studioEmbed ?? false,
    },
  );
}

export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: unknown,
  options: TransformOptions,
): Promise<string> {
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) return source;

  const enrichedOptions: TransformOptions = {
    ...options,
    readFile: options.readFile ?? createPipelineReadFile(adapter, projectDir),
    loadImportMap: options.loadImportMap ??
      (() => loadProjectImportMap(projectDir, adapter as RuntimeAdapter)),
  };

  const { code } = await runPipeline(source, filePath, projectDir, enrichedOptions);
  return code;
}

export type {
  PipelineConfig,
  TransformContext,
  TransformOptions,
  TransformPlugin,
  TransformResult,
  TransformTarget,
} from "./types.ts";

export { TransformStage } from "./types.ts";

export {
  createTransformContext,
  createTransformContextSync,
  isBrowser,
  isMDX,
  isSSR,
  isTypeScript,
} from "./context.ts";

const logger = rendererLogger.component("pipeline");
