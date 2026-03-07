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
import { computeConfigHash } from "#veryfront/cache/config-hash.ts";
import { computeDepsHash } from "#veryfront/cache/dependency-graph.ts";
import type {
  PipelineConfig,
  TransformOptions,
  TransformPlugin,
  TransformResult,
} from "./types.ts";
import {
  compilePlugin,
  cssStripPlugin,
  finalizePlugin,
  parsePlugin,
  resolveImportsPlugin,
  ssrHttpCachePlugin,
  ssrHttpStubPlugin,
  ssrVfModulesPlugin,
} from "./stages/index.ts";
import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { ensureHttpBundlesExist } from "../esm/http-cache.ts";
import { extractHttpBundlePaths } from "#veryfront/modules/react-loader/ssr-module-loader/http-bundle-helpers.ts";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { validateBundleGroup } from "../esm/bundle-manifest.ts";
import { extractFrameworkBundlePaths } from "../shared/framework-bundle-paths.ts";

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

  // If we have a manifest ID, use the faster manifest-based validation
  if (bundleManifestId) {
    const validation = await validateBundleGroup(bundleManifestId, cacheDir);
    if (validation.valid) return true;

    logger.debug("Bundle manifest validation failed", {
      cacheKey: cacheKey.slice(-40),
      manifestId: bundleManifestId.slice(0, 12),
      failedCount: validation.failedHashes.length,
    });
    return false;
  }

  // Fall back to extracting bundle paths from code and validating each
  const bundlePaths = extractHttpBundlePaths(code);
  if (bundlePaths.length === 0) return true;

  const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
  if (failed.length === 0) return true;

  logger.debug("HTTP bundle validation failed", {
    cacheKey: cacheKey.slice(-40),
    failedCount: failed.length,
    totalBundles: bundlePaths.length,
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

      const configHash = await computeConfigHash({
        reactVersion: ctx.reactVersion,
        jsxImportSource: ctx.jsxImportSource,
        studioEmbed: ctx.studioEmbed,
        dev: ctx.dev,
      });

      const depsHash = await computeDepsHashSafe(filePath, projectDir, options.readFile);

      const cacheKey = generateCacheKey(
        filePath,
        ctx.contentHash,
        options.ssr ?? false,
        options.studioEmbed ?? false,
        { depsHash, configHash, projectId: options.projectId },
      );

      const cached = await getCachedTransformAsync(cacheKey);
      if (cached) {
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

      const basePipeline = options.ssr ? SSR_PIPELINE : BROWSER_PIPELINE;
      const pipeline = config?.plugins
        ? [...basePipeline, ...config.plugins].sort((a, b) => a.stage - b.stage)
        : basePipeline;

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
      setCachedTransformAsync(cacheKey, ctx.code, ctx.contentHash, undefined, bundleManifestId)
        .catch(
          (error) => {
            logger.debug("Failed to cache transform", { error });
          },
        );

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

async function computeDepsHashSafe(
  filePath: string,
  projectDir: string,
  readFile?: (path: string) => Promise<string>,
): Promise<string | undefined> {
  if (!readFile) return undefined;

  try {
    return await computeDepsHash(filePath, readFile, projectDir);
  } catch (err) {
    logger.debug("depsHash computation failed, skipping", {
      file: filePath.slice(-60),
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export async function transformToESM(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: unknown,
  options: TransformOptions,
): Promise<string> {
  if (filePath.endsWith(".css") || filePath.endsWith(".json")) return source;

  const enrichedOptions: TransformOptions = options.readFile
    ? options
    : { ...options, readFile: buildReadFile(adapter, projectDir) };

  const { code } = await runPipeline(source, filePath, projectDir, enrichedOptions);
  return code;
}

/** Extract readFile from adapter if available, for dependency hash computation. */
function extractReadFile(adapter: unknown): ((path: string) => Promise<string>) | undefined {
  const a = adapter as { fs?: { readFile?: (path: string) => Promise<string> } } | null;
  const readFile = a?.fs?.readFile;
  if (typeof readFile !== "function") return undefined;
  return (path: string) => readFile.call(a!.fs, path);
}

/**
 * Build a readFile helper that avoids routing local framework paths
 * through the remote adapter.
 *
 * This prevents API fetches for file:// or absolute paths outside projectDir
 * (e.g. framework files under /usr/local/lib/node_modules/veryfront).
 */
function buildReadFile(adapter: unknown, projectDir: string): (path: string) => Promise<string> {
  const adapterRead = extractReadFile(adapter);
  const fs = createFileSystem();
  const normalizedProjectDir = projectDir.replace(/\/+$/, "");

  return async (path: string): Promise<string> => {
    const normalizedPath = path.startsWith("file://") ? path.slice("file://".length) : path;

    const isOutsideProject = normalizedPath.startsWith("/") &&
      normalizedProjectDir.length > 0 &&
      !normalizedPath.startsWith(normalizedProjectDir);

    if (isOutsideProject) return fs.readTextFile(normalizedPath);
    if (adapterRead) return adapterRead(normalizedPath);
    return fs.readTextFile(normalizedPath);
  };
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
