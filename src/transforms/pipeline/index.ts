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
import {
  fromFileUrl,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from "#veryfront/compat/path";
import { getHttpBundleCacheDir } from "#veryfront/utils/cache-dir.ts";
import { validateCachedBundlesByManifestOrCode } from "../esm/cached-bundle-validation.ts";
import { extractFrameworkBundlePaths } from "../shared/framework-bundle-paths.ts";
import { errorLogName, fileLogLabel, textLogLabel } from "../shared/log-context.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";

function cacheKeyLogId(cacheKey: string): string {
  return hashCodeHex(cacheKey).slice(0, 16);
}

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
    logger.warn("Cache contains unresolved _vf_modules import, invalidating", {
      cacheKeyId: cacheKeyLogId(cacheKey),
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
        bundleFile: fileLogLabel(path),
        errorName: errorLogName(error),
      });
      missing.push(path);
    }
  }

  if (missing.length === 0) return true;

  logger.debug("Framework bundle validation failed", {
    cacheKeyId: cacheKeyLogId(cacheKey),
    failedCount: missing.length,
    totalBundles: bundlePaths.length,
    firstMissing: fileLogLabel(missing[0]),
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
    cacheKeyId: cacheKeyLogId(cacheKey),
    manifestId: bundleManifestId?.slice(0, 12),
    failedCount: validation.failedHashes.length,
    reason: validation.reason,
    source: validation.source,
  });
  return false;
}

/** Run the configured SSR or browser transform pipeline. */
export function runPipeline(
  source: string,
  filePath: string,
  projectDir: string,
  options: TransformOptions,
  config?: PipelineConfig,
): Promise<TransformResult> {
  const fileName = fileLogLabel(filePath);

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
        moduleServerUrl: ctx.moduleServerUrl,
        vendorBundleHash: ctx.vendorBundleHash,
        apiBaseUrl: ctx.apiBaseUrl,
      });

      const dependencyHash = await computeDepsHashIfConfigured(
        filePath,
        projectDir,
        options.readFile,
        options.dependencyHashCache,
      );

      const cacheKey = generateCacheKey(
        filePath,
        ctx.contentHash,
        options.ssr ?? false,
        options.studioEmbed ?? false,
        { depsHash: dependencyHash.value, configHash, projectId: options.projectId },
      );

      // Custom plugin functions have no stable cross-process identity. Until the
      // plugin contract exposes one, caching their output can return another
      // plugin implementation's result for the same source.
      const transformCacheable = dependencyHash.cacheable && !config?.plugins?.length;
      const cached = transformCacheable ? await getCachedTransformAsync(cacheKey) : undefined;
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
              file: fileLogLabel(filePath),
            });
            // Fall through to re-run the pipeline
          } else if (!frameworkBundlesValid) {
            logger.debug("Cache invalidated due to missing framework bundles", {
              file: fileLogLabel(filePath),
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
        const stageLabel = textLogLabel(plugin.name, "unnamed-stage");

        try {
          ctx.code = await withSpan(
            "transform.stage",
            async () => plugin.transform(ctx),
            { "transform.stage": stageLabel, "transform.stage_order": plugin.stage },
          );
        } catch (error) {
          logger.error("Pipeline stage failed", {
            file: fileLogLabel(filePath),
            stage: stageLabel,
            errorName: errorLogName(error),
          });
          throw error;
        }

        recordStageTiming(ctx, plugin.stage, stageStart);
      }

      // Store the bundleManifestId from ssrHttpCachePlugin for future cache validation
      const bundleManifestId = ctx.metadata.get("bundleManifestId") as string | undefined;
      if (transformCacheable) {
        setCachedTransformAsync(cacheKey, ctx.code, ctx.contentHash, undefined, bundleManifestId)
          .catch(
            (error) => {
              logger.debug("Failed to cache transform", {
                errorName: errorLogName(error),
              });
            },
          );
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

async function computeDepsHashIfConfigured(
  filePath: string,
  projectDir: string,
  readFile?: (path: string) => Promise<string>,
  dependencyHashCache?: TransformOptions["dependencyHashCache"],
): Promise<{ value?: string; cacheable: boolean }> {
  if (!readFile) return { cacheable: true };

  const normalizedProjectDir = resolve(projectDir);
  const normalizedRootPath = normalizeDependencyPath(filePath, normalizedProjectDir);
  if (!isWithinDirectory(normalizedProjectDir, normalizedRootPath)) {
    logger.debug("Transform cache disabled for a source outside the project root");
    return { cacheable: false };
  }

  const scopedReader = createProjectScopedDependencyReader(
    readFile,
    normalizedProjectDir,
    normalizedRootPath,
  );
  try {
    return {
      value: await computeDepsHash(
        normalizedRootPath,
        scopedReader.readFile,
        normalizedProjectDir,
        dependencyHashCache,
      ),
      cacheable: true,
    };
  } catch (error) {
    if (scopedReader.wasPhysicalBoundaryRejected()) {
      throw new Error(DEPENDENCY_PATH_REJECTED);
    }

    logger.debug("Transform cache disabled because dependency hashing was incomplete", {
      errorName: errorLogName(error),
      boundaryRejected: scopedReader.wasBoundaryRejected(),
    });
    return { cacheable: false };
  }
}

/** Transform one source module and return its generated ESM code. */
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
    : { ...options, readFile: buildReadFile(adapter) };

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
 * Build the underlying dependency reader.
 * Project-boundary validation is applied inside {@link runPipeline} so callers
 * that supply `TransformOptions.readFile` receive the same protection.
 */
function buildReadFile(adapter: unknown): (path: string) => Promise<string> {
  const adapterRead = extractReadFile(adapter);
  const fs = createFileSystem();

  return async (path: string): Promise<string> => {
    if (adapterRead) return await adapterRead(path);
    return await fs.readTextFile(path);
  };
}

const DEPENDENCY_PATH_REJECTED = "Dependency path is outside the project root";

function isWithinDirectory(baseDir: string, candidate: string): boolean {
  const relativePath = relative(baseDir, candidate);
  return relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath));
}

function normalizeDependencyPath(path: string, projectDir: string): string {
  let filePath = path;
  if (path.startsWith("file://")) {
    try {
      filePath = fromFileUrl(path);
    } catch {
      throw new Error(DEPENDENCY_PATH_REJECTED);
    }
  }

  return isAbsolute(filePath) ? normalize(filePath) : resolve(projectDir, filePath);
}

function getDependencyReadCandidates(path: string, rootPath: string): string[] {
  if (path === rootPath) return [path];

  const candidates: string[] = [];
  if (path.endsWith(".js")) {
    const base = path.slice(0, -3);
    candidates.push(`${base}.tsx`, `${base}.ts`, `${base}.jsx`, path, `${base}.mdx`);
  } else if (!/\.[^/]+$/.test(path)) {
    candidates.push(
      `${path}.ts`,
      `${path}.tsx`,
      `${path}.js`,
      `${path}.jsx`,
      join(path, "index.ts"),
      join(path, "index.tsx"),
      join(path, "index.js"),
      join(path, "index.jsx"),
    );
  } else {
    candidates.push(path);
  }
  return candidates;
}

/**
 * Restrict dependency hashing to the declared project root.
 *
 * Lexical containment rejects traversal and sibling-prefix paths. When the
 * project exists on the local filesystem, physical containment also rejects
 * symlinks that resolve outside the root. Error text intentionally omits paths.
 */
function createProjectScopedDependencyReader(
  readFile: (path: string) => Promise<string>,
  projectDir: string,
  rootPath: string,
): {
  readFile: (path: string) => Promise<string>;
  wasBoundaryRejected: () => boolean;
  wasPhysicalBoundaryRejected: () => boolean;
} {
  const fs = createFileSystem();
  const normalizedProjectDir = resolve(projectDir);
  const canonicalProjectDir = fs.realPath
    ? fs.realPath(normalizedProjectDir).catch(() => null)
    : Promise.resolve(null);
  let boundaryRejected = false;
  let physicalBoundaryRejected = false;

  return {
    readFile: async (path: string): Promise<string> => {
      const normalizedPath = normalizeDependencyPath(path, normalizedProjectDir);
      if (!isWithinDirectory(normalizedProjectDir, normalizedPath)) {
        boundaryRejected = true;
        throw new Error(DEPENDENCY_PATH_REJECTED);
      }

      const canonicalRoot = await canonicalProjectDir;
      let lastReadError: unknown;
      for (const candidate of getDependencyReadCandidates(normalizedPath, rootPath)) {
        if (!isWithinDirectory(normalizedProjectDir, candidate)) {
          boundaryRejected = true;
          throw new Error(DEPENDENCY_PATH_REJECTED);
        }

        if (canonicalRoot && fs.realPath) {
          const canonicalPath = await fs.realPath(candidate).catch(() => null);
          if (canonicalPath && !isWithinDirectory(canonicalRoot, canonicalPath)) {
            boundaryRejected = true;
            physicalBoundaryRejected = true;
            throw new Error(DEPENDENCY_PATH_REJECTED);
          }
        }

        try {
          return await readFile(candidate);
        } catch (error) {
          lastReadError = error;
        }
      }

      throw lastReadError instanceof Error
        ? lastReadError
        : new Error("Dependency file could not be read");
    },
    wasBoundaryRejected: () => boundaryRejected,
    wasPhysicalBoundaryRejected: () => physicalBoundaryRejected,
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
