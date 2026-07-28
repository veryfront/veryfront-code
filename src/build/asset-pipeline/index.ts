/**
 * Build Asset Pipeline
 *
 * @module build/asset-pipeline
 */

export type {
  BrowserTargets,
  CriticalCSSResult,
  CSSBundle,
  CSSOptimizationOptions,
  CSSOptimizationStrategy,
  CSSOptimizerStats,
} from "./css-optimizer/index.ts";
export { CSSOptimizerService } from "./css-optimizer/index.ts";
export { CacheManager, loadCSSManifest } from "./css-optimizer/index.ts";
export { extractCriticalCSS } from "./css-optimizer/index.ts";
export {
  LightningCSSStrategy,
  MinificationStrategy,
  PurgeStrategy,
} from "./css-optimizer/index.ts";
export { CSSUtils } from "./css-optimizer/index.ts";
export { CSSOptimizer, optimizeCSS } from "./css-optimizer/index.ts";

import { isAbsolute, resolve } from "#veryfront/compat/path/index.ts";
import { getErrorMessage } from "#veryfront/errors";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isContainedBuildPath } from "../bundler/project-module-resolver.ts";
import { hasControlCharacters } from "../utils/string-validation.ts";
import {
  DEFAULT_CSS_OPTIONS,
  LIGHTNING_CSS_MODULE_SPECIFIER,
  PURGE_CSS_MODULE_SPECIFIER,
} from "./css-optimizer/constants.ts";
import { type CSSOptimizationOptions, CSSOptimizer } from "./css-optimizer/index.ts";
import {
  DEFAULT_OPTIONS as DEFAULT_IMAGE_OPTIONS,
  SHARP_MODULE_SPECIFIER,
} from "./image-optimizer/constants.ts";
import { type ImageOptimizationOptions, ImageOptimizer } from "./image-optimizer/index.ts";
import {
  processTailwindCSSInDirectory,
  type TailwindProcessResult,
} from "./tailwind-processor/index.ts";
import {
  DEFAULT_TAILWIND_OUTPUT_DIRECTORY,
  DEFAULT_TAILWIND_SOURCE_DIRECTORY,
} from "./tailwind-processor/constants.ts";

export interface TailwindBatchOptions {
  enabled?: boolean;
  projectDir: string;
  sourceDir?: string;
  outputDir?: string;
}

export interface AssetPipelineOptions {
  images?: ImageOptimizationOptions;
  css?: CSSOptimizationOptions;
  tailwind?: TailwindBatchOptions;
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
  tailwind: {
    processed: number;
    utilities: number;
    enabled: boolean;
  };
  duration: number;
}

export interface AssetPipelineDependencyStatus {
  sharp: boolean;
  lightningCSS: boolean;
  purgeCSS: boolean;
}

interface PlannedStageOutput {
  stage: "images" | "css" | "tailwind";
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
  for (const stage of ["images", "css", "tailwind"] as const) {
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
      ["css.browsers", (options as AssetPipelineOptions).css?.browsers],
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
      browsers: options.css.browsers === undefined ? undefined : [...options.css.browsers],
      purgeContent: options.css.purgeContent === undefined
        ? undefined
        : [...options.css.purgeContent],
      purgeSafelist: options.css.purgeSafelist === undefined
        ? undefined
        : [...options.css.purgeSafelist],
    },
    tailwind: options.tailwind === undefined ? undefined : { ...options.tailwind },
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
  if (isEnabled(options.tailwind)) {
    const projectDir = resolveProjectDirectory(
      options.tailwind.projectDir,
      "Asset pipeline Tailwind projectDir",
      false,
    );
    outputs.push(
      planStageOutput(
        "tailwind",
        projectDir,
        options.tailwind.outputDir,
        DEFAULT_TAILWIND_OUTPUT_DIRECTORY,
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
    tailwind: { processed: 0, utilities: 0, enabled: false },
    duration: 0,
  };

  const imageOptimizer = isEnabled(configured.images)
    ? new ImageOptimizer(configured.images)
    : null;
  const cssOptimizer = isEnabled(configured.css) ? new CSSOptimizer(configured.css) : null;

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

  const tailwindOptions = configured.tailwind;
  if (isEnabled(tailwindOptions)) {
    const {
      projectDir,
      sourceDir = DEFAULT_TAILWIND_SOURCE_DIRECTORY,
      outputDir = DEFAULT_TAILWIND_OUTPUT_DIRECTORY,
    } = tailwindOptions;
    safePath(projectDir, "Asset pipeline Tailwind projectDir");
    const tailwindResults: TailwindProcessResult[] = await processTailwindCSSInDirectory(
      projectDir,
      sourceDir,
      outputDir,
    );
    const totalUtilities = tailwindResults.reduce(
      (sum, current) => sum + current.detectedUtilities,
      0,
    );
    if (!Number.isSafeInteger(totalUtilities) || totalUtilities < 0) {
      throw new TypeError("Tailwind processor returned invalid utility statistics");
    }
    result.tailwind = {
      processed: tailwindResults.length,
      utilities: totalUtilities,
      enabled: true,
    };
    logger.info("Tailwind CSS processing complete", {
      files: tailwindResults.length,
      utilities: totalUtilities,
    });
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
    tailwindEnabled: result.tailwind.enabled,
  });

  return result;
}

async function probeDependency(
  label: string,
  load: () => Promise<unknown>,
  validate: (module: unknown) => boolean,
): Promise<boolean> {
  try {
    const module = await load();
    if (!validate(module)) {
      throw new TypeError(`${label} module has an invalid export shape`);
    }
    return true;
  } catch (error) {
    logger.debug(`${label} is unavailable`, {
      error: getErrorMessage(error),
    });
    return false;
  }
}

export async function checkAssetPipelineDependencies(): Promise<
  AssetPipelineDependencyStatus
> {
  const [sharp, lightningCSS, purgeCSS] = await Promise.all([
    probeDependency(
      "Sharp",
      () => import(SHARP_MODULE_SPECIFIER),
      (module) =>
        typeof module === "object" &&
        module !== null &&
        typeof (module as { default?: unknown }).default === "function",
    ),
    probeDependency(
      "Lightning CSS",
      () => import(LIGHTNING_CSS_MODULE_SPECIFIER),
      (module) =>
        typeof module === "object" &&
        module !== null &&
        typeof (module as { transform?: unknown }).transform === "function",
    ),
    probeDependency(
      "PurgeCSS",
      () => import(PURGE_CSS_MODULE_SPECIFIER),
      (module) =>
        typeof module === "object" &&
        module !== null &&
        typeof (module as { PurgeCSS?: unknown }).PurgeCSS === "function",
    ),
  ]);
  return { sharp, lightningCSS, purgeCSS };
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
      available: dependencies.sharp,
      name: "Sharp",
      capability: "Sharp image optimizer",
      specifier: SHARP_MODULE_SPECIFIER,
    },
    {
      available: dependencies.lightningCSS,
      name: "Lightning CSS",
      capability: "Lightning CSS optimizer",
      specifier: LIGHTNING_CSS_MODULE_SPECIFIER,
    },
    {
      available: dependencies.purgeCSS,
      name: "PurgeCSS",
      capability: "PurgeCSS optimizer",
      specifier: PURGE_CSS_MODULE_SPECIFIER,
    },
  ];

  for (const dependency of descriptors) {
    if (dependency.available) {
      available.push(dependency.capability);
    } else {
      missing.push(dependency.name);
      recommendations.push(
        `Ensure ${dependency.specifier} is installed and recorded in deno.lock`,
      );
    }
  }

  return { available, missing, recommendations };
}
