/**
 * Build Asset Pipeline
 *
 * @module build/asset-pipeline
 */

export type {
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "./css-optimizer/index.ts";
export { CSSOptimizerService } from "./css-optimizer/index.ts";
export { CacheManager, loadCSSManifest } from "./css-optimizer/index.ts";
export { extractCriticalCSS } from "./css-optimizer/index.ts";
export { MinificationStrategy, PurgeStrategy } from "./css-optimizer/index.ts";
export { CSSUtils } from "./css-optimizer/index.ts";
export { CSSOptimizer, optimizeCSS } from "./css-optimizer/index.ts";

import { isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import { getErrorMessage } from "#veryfront/errors";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import {
  assertCSSOptimizationEngine,
  assertCSSPurgingEngine,
  CSSOptimizationEngineName,
  CSSPurgingEngineName,
} from "#veryfront/extensions/css/index.ts";
import {
  assertImageOptimizationEngine,
  ImageOptimizationEngineName,
} from "#veryfront/extensions/image/index.ts";
import { getRecommendation } from "#veryfront/extensions/recommendations.ts";
import { acquireConfiguredCSSOptimization } from "./css-optimizer/optimization-engine.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isContainedBuildPath } from "../bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../utils/string-validation.ts";
import { DEFAULT_CSS_OPTIONS } from "./css-optimizer/constants.ts";
import { type CSSOptimizationOptions, CSSOptimizer } from "./css-optimizer/index.ts";
import { DEFAULT_OPTIONS as DEFAULT_IMAGE_OPTIONS } from "./image-optimizer/constants.ts";
import { type ImageOptimizationOptions, ImageOptimizer } from "./image-optimizer/index.ts";
export interface AssetPipelineOptions {
  images?: ImageOptimizationOptions;
  css?: CSSOptimizationOptions;
}

export interface AssetPipelineResult {
  images: {
    optimized: number;
    variants: number;
    totalSize: number;
    enabled: boolean;
  };
  css: {
    optimized: number;
    originalSize: number;
    minifiedSize: number;
    savings: number;
    enabled: boolean;
  };
  duration: number;
}

export interface AssetPipelineDependencyStatus {
  /** An image optimization engine is registered and its contract shape is valid. */
  imageOptimizationEngineRegistered: boolean;
  /** A CSS optimization engine is registered and its contract shape is valid. */
  cssOptimizationEngineRegistered: boolean;
  /** A provider-neutral CSS purging engine is registered and valid. */
  cssPurgingEngineRegistered: boolean;
}

interface PlannedStageOutput {
  stage: "images" | "css";
  path: string;
}

function safePath(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(`${label} must be a safe non-empty path`);
  }
}

function validateOptionsObject(
  options: unknown,
): asserts options is AssetPipelineOptions {
  if (
    typeof options !== "object" ||
    options === null ||
    Array.isArray(options)
  ) {
    throw new TypeError("Asset pipeline options must be an object");
  }
  const unsupported = Object.keys(options).filter((key) => key !== "images" && key !== "css");
  if (unsupported.length > 0) {
    throw new TypeError(
      `Asset pipeline contains unsupported stage ${JSON.stringify(unsupported[0])}`,
    );
  }
  for (const stage of ["images", "css"] as const) {
    const value = (options as AssetPipelineOptions)[stage];
    if (
      value !== undefined &&
      (typeof value !== "object" || value === null || Array.isArray(value))
    ) {
      throw new TypeError(`Asset pipeline ${stage} options must be an object`);
    }
    if (
      value?.enabled !== undefined &&
      typeof value.enabled !== "boolean"
    ) {
      throw new TypeError(`Asset pipeline ${stage}.enabled must be a boolean`);
    }
  }
  for (
    const [label, value] of [
      ["images.formats", (options as AssetPipelineOptions).images?.formats],
      ["images.sizes", (options as AssetPipelineOptions).images?.sizes],
      ["css.inputFiles", (options as AssetPipelineOptions).css?.inputFiles],
      ["css.purgeContent", (options as AssetPipelineOptions).css?.purgeContent],
      ["css.purgeSafelist", (options as AssetPipelineOptions).css?.purgeSafelist],
    ] as const
  ) {
    if (value !== undefined && !Array.isArray(value)) {
      throw new TypeError(`Asset pipeline ${label} must be an array`);
    }
  }
}

function snapshotOptions(options: AssetPipelineOptions): AssetPipelineOptions {
  return {
    images: options.images === undefined ? undefined : {
      ...options.images,
      formats: options.images.formats === undefined ? undefined : [...options.images.formats],
      sizes: options.images.sizes === undefined ? undefined : [...options.images.sizes],
    },
    css: options.css === undefined ? undefined : {
      ...options.css,
      inputFiles: options.css.inputFiles === undefined ? undefined : [...options.css.inputFiles],
      purgeContent: options.css.purgeContent === undefined
        ? undefined
        : [...options.css.purgeContent],
      purgeSafelist: options.css.purgeSafelist === undefined
        ? undefined
        : [...options.css.purgeSafelist],
    },
  };
}

function isEnabled<T extends { enabled?: boolean }>(
  options: T | undefined,
): options is T {
  return options !== undefined && options.enabled !== false;
}

function resolveProjectDirectory(
  configured: unknown,
  label: string,
  requireAbsolute: boolean,
): string {
  const projectDir = configured ?? cwd();
  safePath(projectDir, label);
  if (requireAbsolute && !isAbsolute(projectDir)) {
    throw new TypeError(`${label} must be absolute`);
  }
  return resolve(projectDir);
}

function planStageOutput(
  stage: PlannedStageOutput["stage"],
  projectDir: string,
  configuredOutput: unknown,
  defaultOutput: string,
): PlannedStageOutput {
  const output = configuredOutput ?? defaultOutput;
  safePath(output, `Asset pipeline ${stage} output directory`);
  const path = isAbsolute(output) ? resolve(output) : resolve(projectDir, output);
  if (path === projectDir || !isContainedBuildPath(projectDir, path)) {
    throw new TypeError(
      `Asset pipeline ${stage} output directory must be inside its project`,
    );
  }
  return { stage, path };
}

function validateStageOutputSeparation(
  options: AssetPipelineOptions,
): void {
  const outputs: PlannedStageOutput[] = [];
  if (isEnabled(options.images)) {
    const projectDir = resolveProjectDirectory(
      options.images.projectDir,
      "Asset pipeline images projectDir",
      true,
    );
    outputs.push(
      planStageOutput(
        "images",
        projectDir,
        options.images.outputDir,
        DEFAULT_IMAGE_OPTIONS.outputDir,
      ),
    );
  }
  if (isEnabled(options.css)) {
    const projectDir = resolveProjectDirectory(
      options.css.projectDir,
      "Asset pipeline CSS projectDir",
      true,
    );
    outputs.push(
      planStageOutput(
        "css",
        projectDir,
        options.css.outputDir,
        DEFAULT_CSS_OPTIONS.outputDir,
      ),
    );
  }
  for (const [index, first] of outputs.entries()) {
    for (const second of outputs.slice(index + 1)) {
      if (
        isContainedBuildPath(first.path, second.path) ||
        isContainedBuildPath(second.path, first.path)
      ) {
        throw new TypeError(
          `Asset pipeline output directories for ${first.stage} and ${second.stage} must not overlap`,
        );
      }
    }
  }
}

export async function runAssetPipeline(
  options: AssetPipelineOptions = {},
): Promise<AssetPipelineResult> {
  validateOptionsObject(options);
  const configured = snapshotOptions(options);
  validateStageOutputSeparation(configured);
  const startTime = Date.now();

  logger.info("Starting asset pipeline");

  const result: AssetPipelineResult = {
    images: { optimized: 0, variants: 0, totalSize: 0, enabled: false },
    css: { optimized: 0, originalSize: 0, minifiedSize: 0, savings: 0, enabled: false },
    duration: 0,
  };

  const optimizationSession = isEnabled(configured.css)
    ? acquireConfiguredCSSOptimization()
    : undefined;
  const imageOptimizer = isEnabled(configured.images)
    ? new ImageOptimizer(configured.images)
    : null;
  const cssOptimizer = isEnabled(configured.css)
    ? new CSSOptimizer(configured.css, undefined, { optimizationSession })
    : null;

  // Resolve required runtime dependencies before any stage publishes output.
  const initialization = await Promise.allSettled([
    imageOptimizer?.init() ?? Promise.resolve(false),
    cssOptimizer?.init() ?? Promise.resolve(false),
  ]);
  const initializationErrors = initialization.flatMap((entry) =>
    entry.status === "rejected" ? [entry.reason] : []
  );
  if (initializationErrors.length === 1) throw initializationErrors[0];
  if (initializationErrors.length > 1) {
    throw new AggregateError(
      initializationErrors,
      "Multiple asset-pipeline dependencies failed initialization",
    );
  }

  if (cssOptimizer) {
    await cssOptimizer.optimize();
    const cssStats = await cssOptimizer.getStats();
    result.css = {
      optimized: cssStats.totalFiles,
      originalSize: cssStats.originalSize,
      minifiedSize: cssStats.minifiedSize,
      savings: cssStats.averageSavings,
      enabled: true,
    };
    logger.info("CSS optimization complete", {
      files: cssStats.totalFiles,
      original: `${(cssStats.originalSize / 1024).toFixed(1)}KB`,
      minified: `${(cssStats.minifiedSize / 1024).toFixed(1)}KB`,
      savings: `${cssStats.averageSavings.toFixed(1)}%`,
    });
  }

  if (imageOptimizer) {
    await imageOptimizer.optimize();
    const imageStats = imageOptimizer.getStats();
    result.images = {
      optimized: imageStats.totalImages,
      variants: imageStats.totalVariants,
      totalSize: imageStats.totalSize,
      enabled: true,
    };
    logger.info("Image optimization complete", {
      images: imageStats.totalImages,
      variants: imageStats.totalVariants,
      size: `${(imageStats.totalSize / 1024 / 1024).toFixed(2)}MB`,
    });
  }

  result.duration = Date.now() - startTime;

  logger.info("Asset pipeline complete", {
    duration: `${result.duration}ms`,
    imagesEnabled: result.images.enabled,
    cssEnabled: result.css.enabled,
  });

  return result;
}

export async function checkAssetPipelineDependencies(): Promise<
  AssetPipelineDependencyStatus
> {
  const registeredImageEngine = tryResolve<unknown>(ImageOptimizationEngineName);
  let imageOptimizationEngineRegistered = false;
  if (registeredImageEngine !== undefined) {
    try {
      assertImageOptimizationEngine(registeredImageEngine);
      imageOptimizationEngineRegistered = true;
    } catch (error) {
      logger.debug("Registered image optimization engine is invalid", {
        error: getErrorMessage(error),
      });
    }
  }

  const registeredEngine = tryResolve<unknown>(CSSOptimizationEngineName);
  let cssOptimizationEngineRegistered = false;
  if (registeredEngine !== undefined) {
    try {
      assertCSSOptimizationEngine(registeredEngine);
      cssOptimizationEngineRegistered = true;
    } catch (error) {
      logger.debug("Registered CSS optimization engine is invalid", {
        error: getErrorMessage(error),
      });
    }
  }

  const registeredPurgingEngine = tryResolve<unknown>(CSSPurgingEngineName);
  let cssPurgingEngineRegistered = false;
  if (registeredPurgingEngine !== undefined) {
    try {
      assertCSSPurgingEngine(registeredPurgingEngine);
      cssPurgingEngineRegistered = true;
    } catch (error) {
      logger.debug("Registered CSS purging engine is invalid", {
        error: getErrorMessage(error),
      });
    }
  }

  return {
    imageOptimizationEngineRegistered,
    cssOptimizationEngineRegistered,
    cssPurgingEngineRegistered,
  };
}

export async function getAssetPipelineStatus(): Promise<{
  available: string[];
  missing: string[];
  recommendations: string[];
}> {
  const dependencies = await checkAssetPipelineDependencies();
  const available: string[] = [];
  const missing: string[] = [];
  const recommendations: string[] = [];
  const descriptors = [
    {
      available: dependencies.imageOptimizationEngineRegistered,
      name: "Image optimization engine",
      capability: "Image optimization engine",
      recommendation: `Install and explicitly register ${
        getRecommendation(ImageOptimizationEngineName) ??
          "an ImageOptimizationEngine extension"
      }`,
    },
    {
      available: dependencies.cssOptimizationEngineRegistered,
      name: "CSS optimization engine",
      capability: "CSS optimization engine",
      recommendation: `Install and explicitly register ${
        getRecommendation(CSSOptimizationEngineName) ??
          "a CSSOptimizationEngine extension"
      }`,
    },
    {
      available: dependencies.cssPurgingEngineRegistered,
      name: "CSS purging engine",
      capability: "CSS purging engine",
      recommendation: `Install and explicitly register ${
        getRecommendation(CSSPurgingEngineName) ?? "a CSSPurgingEngine extension"
      }`,
    },
  ];

  for (const dependency of descriptors) {
    if (dependency.available) {
      available.push(dependency.capability);
    } else {
      missing.push(dependency.name);
      recommendations.push(dependency.recommendation);
    }
  }

  return { available, missing, recommendations };
}
