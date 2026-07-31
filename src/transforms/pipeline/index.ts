/**
 * Transforms Pipeline
 *
 * @module transforms/pipeline
 */

import {
  generateCacheKey,
  observeCachedTransformForWrite,
  publishCachedTransformWithPermit,
  releaseCachedTransformWritePermit,
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
import { findMissingFrameworkBundlePaths } from "../shared/framework-bundle-paths.ts";
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
import { resolveDependencyPinningSnapshot } from "../esm/package-registry.ts";
import {
  type DependencyResolutionObservation,
  resolveDependencyPinForImport,
  validateDependencyResolutionObservations,
} from "../import-rewriter/dependency-resolution.ts";
import { getDependencyResolutionObservations } from "./stages/resolve-imports.ts";

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

  const missing = await findMissingFrameworkBundlePaths(code, exists, {
    onError: (path, error) => {
      logger.error("Framework bundle validation error", {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });

  if (missing.length === 0) return true;

  logger.debug("Framework bundle validation failed", {
    cacheKey: cacheKey.slice(-40),
    failedCount: missing.length,
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

/**
 * Pin-on entries created before observation metadata existed are deliberately
 * invalid. Recomputing once records the unresolved imports needed for future
 * scheduler retries without rerunning every transform stage.
 */
function validateCachedDependencyResolutionObservations(
  cached: {
    readonly dependencyResolutionObservations?: ReadonlyArray<
      DependencyResolutionObservation
    >;
  },
  ctx: Awaited<ReturnType<typeof createTransformContext>>,
): readonly DependencyResolutionObservation[] | null {
  if (!ctx.dependencyPinningCacheKey?.startsWith("on:")) return [];

  return validateDependencyResolutionObservations(
    cached?.dependencyResolutionObservations,
    ctx.dependencyPinningDependencies,
  );
}

function replayDependencyResolutionObservations(
  observations: readonly DependencyResolutionObservation[],
  ctx: Awaited<ReturnType<typeof createTransformContext>>,
): void {
  for (const observation of observations) {
    // The cached value is inert evidence only. The shared resolver re-evaluates
    // current source authority and scheduler retry TTLs before any write-back.
    resolveDependencyPinForImport(observation.packageName, {
      ...ctx,
      // SSR scheduling belongs to the post-pipeline adapter. Still replay the
      // observation callback so an outer cache can persist the inner hit.
      dependencyResolutionObservationOnly: ctx.target === "ssr",
    });
  }
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

      const dependencySnapshot = await resolveDependencyPinningSnapshot(
        options.dependencyPinningSource ?? projectDir,
        options.dependencyPinningCacheKey,
        options.dependencyPinningDependencies,
      );
      const dependencyPinningCacheKey = dependencySnapshot.cacheKey;
      // Keep the cache key and dependency map atomic for every later stage and
      // post-transform rewrite in this request without mutating caller-owned
      // options (which may be frozen or shared by concurrent transforms).
      const effectiveOptions: TransformOptions = {
        ...options,
        dependencyPinningCacheKey,
        dependencyPinningDependencies: dependencySnapshot.dependencies,
      };

      const ctx = await createTransformContext(source, filePath, projectDir, effectiveOptions);
      ctx.debug = config?.debug ?? false;
      ctx.onProgress?.({ phase: "pipeline:context", filePath });

      const basePipeline = effectiveOptions.ssr ? SSR_PIPELINE : BROWSER_PIPELINE;
      const pipeline = config?.plugins
        ? [...basePipeline, ...config.plugins].sort((a, b) => a.stage - b.stage)
        : basePipeline;
      const pluginIdentity = getCustomPluginCacheIdentity(config?.plugins);

      let importMapFingerprint: string | undefined;
      if (effectiveOptions.ssr) {
        const rawImportMap = await (
          effectiveOptions.loadImportMap?.() ?? loadProjectImportMap(projectDir)
        );
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
        ssr: effectiveOptions.ssr ?? false,
        projectDir,
        moduleServerUrl: ctx.moduleServerUrl,
        moduleServerOrigin: ctx.moduleServerOrigin,
        vendorBundleHash: ctx.vendorBundleHash,
        apiBaseUrl: ctx.apiBaseUrl,
        importMapFingerprint,
        customPlugins: pluginIdentity.cacheable ? pluginIdentity.identity : [],
        dependencyPinningCacheKey,
      });

      const dependencyIdentity = await computeDependencyCacheIdentity(
        filePath,
        projectDir,
        effectiveOptions.readFile,
        effectiveOptions.dependencyHashCache,
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
          effectiveOptions.ssr ?? false,
          effectiveOptions.studioEmbed ?? false,
          {
            depsHash: dependencyIdentity.depsHash,
            configHash,
            projectId: effectiveOptions.projectId,
          },
        )
        : undefined;

      const cacheObservation = cacheKey === undefined
        ? undefined
        : await observeCachedTransformForWrite(cacheKey);
      try {
        const cached = cacheObservation?.entry;
        if (cached && cacheKey !== undefined) {
          const dependencyResolutionObservations = validateCachedDependencyResolutionObservations(
            cached,
            ctx,
          );
          if (dependencyResolutionObservations === null) {
            logger.debug("Cache invalidated due to missing or inconsistent dependency metadata", {
              file: filePath.slice(-60),
            });
            // Fall through to re-run the pipeline.
          } else if (effectiveOptions.ssr) {
            // For SSR transforms, validate bundles exist before returning cached code.
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
              replayDependencyResolutionObservations(
                dependencyResolutionObservations,
                ctx,
              );
              ctx.onProgress?.({ phase: "pipeline:cache-hit", filePath });
              return {
                code: cached.code,
                contentHash: ctx.contentHash,
                timing: new Map(),
                totalMs: performance.now() - transformStart,
                cached: true,
              };
            }
          } else {
            replayDependencyResolutionObservations(
              dependencyResolutionObservations,
              ctx,
            );
            ctx.onProgress?.({ phase: "pipeline:cache-hit", filePath });
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
          ctx.onProgress?.({ phase: `pipeline:${plugin.name}`, filePath });
        }

        // Store the bundleManifestId from ssrHttpCachePlugin for future cache validation
        const bundleManifestId = ctx.metadata.get("bundleManifestId") as string | undefined;
        const dependencyResolutionObservations = getDependencyResolutionObservations(ctx);
        if (cacheKey !== undefined && cacheObservation !== undefined) {
          try {
            await publishCachedTransformWithPermit(
              cacheObservation.permit,
              ctx.code,
              ctx.contentHash,
              bundleManifestId,
              dependencyResolutionObservations,
            );
          } catch (error) {
            logger.warn("Failed to cache transform", {
              failureType: error === null ? "null" : typeof error,
            });
            throw error;
          }
        }

        const totalMs = performance.now() - transformStart;

        if (ctx.debug) {
          logger.debug("Transform complete", formatTimingLog(ctx));
        }

        ctx.onProgress?.({ phase: "pipeline:complete", filePath });

        return {
          code: ctx.code,
          contentHash: ctx.contentHash,
          timing: ctx.timing,
          totalMs,
          cached: false,
        };
      } finally {
        if (cacheObservation) {
          releaseCachedTransformWritePermit(cacheObservation.permit);
        }
      }
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
