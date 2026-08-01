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
  CSSOptimizerDependencies,
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
import {
  captureCSSOptimizationEngine,
  CSSOptimizationEngineName,
} from "#veryfront/extensions/css/index.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { runtime } from "#veryfront/platform/adapters/detect.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import {
  getCanonicalBaseDir,
  getCanonicalPath,
} from "#veryfront/security/path-validation/index.ts";
import { logger } from "#veryfront/utils";
import { isContainedAssetPath } from "../utils/asset-utils.ts";
import { DEFAULT_CSS_OPTIONS } from "./css-optimizer/constants.ts";
import { type CSSOptimizationOptions, CSSOptimizer } from "./css-optimizer/index.ts";
import { DEFAULT_OPTIONS as DEFAULT_IMAGE_OPTIONS } from "./image-optimizer/constants.ts";
import { type ImageOptimizationOptions, ImageOptimizer } from "./image-optimizer/index.ts";
import {
  processTailwindCSSInDirectory,
  type TailwindProcessResult,
} from "./tailwind-processor/index.ts";

const DEFAULT_TAILWIND_OUTPUT_DIR = ".veryfront/css";

type AssetOutputStage = "images" | "tailwind" | "css";

interface AssetOutputPlan {
  stage: AssetOutputStage;
  projectDir: string;
  outputDir: string;
}

interface PhysicalAssetOutputPlan extends AssetOutputPlan {
  physicalOutputDir: string;
}

function resolveStageOutput(
  stage: AssetOutputStage,
  projectDir: string,
  outputDir: string,
): AssetOutputPlan {
  const absoluteProjectDir = resolve(projectDir);
  const absoluteOutputDir = isAbsolute(outputDir)
    ? resolve(outputDir)
    : resolve(absoluteProjectDir, outputDir);

  if (
    absoluteOutputDir === absoluteProjectDir ||
    !isContainedAssetPath(absoluteProjectDir, absoluteOutputDir)
  ) {
    throw new TypeError(
      `${stage} output directory must be inside, and must not equal, its project directory`,
    );
  }

  return {
    stage,
    projectDir: absoluteProjectDir,
    outputDir: absoluteOutputDir,
  };
}

function planAssetOutputs(options: AssetPipelineOptions): AssetOutputPlan[] {
  const plans: AssetOutputPlan[] = [];

  if (options.images !== undefined && options.images.enabled !== false) {
    plans.push(
      resolveStageOutput(
        "images",
        options.images.projectDir ?? cwd(),
        options.images.outputDir ?? DEFAULT_IMAGE_OPTIONS.outputDir,
      ),
    );
  }

  if (
    options.tailwind !== undefined &&
    options.tailwind.enabled !== false &&
    options.tailwind.projectDir
  ) {
    plans.push(
      resolveStageOutput(
        "tailwind",
        options.tailwind.projectDir,
        options.tailwind.outputDir ?? DEFAULT_TAILWIND_OUTPUT_DIR,
      ),
    );
  }

  if (options.css !== undefined && options.css.enabled !== false) {
    plans.push(
      resolveStageOutput(
        "css",
        options.css.projectDir ?? cwd(),
        options.css.outputDir ?? DEFAULT_CSS_OPTIONS.outputDir,
      ),
    );
  }

  return plans;
}

function physicalPathKey(path: string): string {
  let normalized = path.replaceAll("\\", "/").normalize("NFC");
  while (
    normalized.length > 1 &&
    normalized.endsWith("/") &&
    !/^[A-Za-z]:\/$/.test(normalized)
  ) {
    normalized = normalized.slice(0, -1);
  }
  return normalized.toLocaleLowerCase("en-US");
}

function physicalPathContains(basePath: string, candidatePath: string): boolean {
  const base = physicalPathKey(basePath);
  const candidate = physicalPathKey(candidatePath);
  return candidate === base || candidate.startsWith(base.endsWith("/") ? base : `${base}/`);
}

async function validateAssetOutputPlan(options: AssetPipelineOptions): Promise<void> {
  const plans = planAssetOutputs(options);
  if (plans.length < 2) return;

  const adapter = await runtime.get();
  const physicalPlans: PhysicalAssetOutputPlan[] = await Promise.all(
    plans.map(async (plan) => {
      const [physicalProjectDir, physicalOutput] = await Promise.all([
        getCanonicalBaseDir(plan.projectDir, adapter),
        getCanonicalPath(plan.outputDir, adapter),
      ]);

      if (
        physicalPathKey(physicalProjectDir) === physicalPathKey(physicalOutput.path) ||
        !physicalPathContains(physicalProjectDir, physicalOutput.path)
      ) {
        throw new TypeError(
          `${plan.stage} output directory must remain inside, and must not equal, its physical project directory`,
        );
      }

      return {
        ...plan,
        physicalOutputDir: physicalOutput.path,
      };
    }),
  );

  for (let leftIndex = 0; leftIndex < physicalPlans.length; leftIndex += 1) {
    const left = physicalPlans[leftIndex]!;
    for (let rightIndex = leftIndex + 1; rightIndex < physicalPlans.length; rightIndex += 1) {
      const right = physicalPlans[rightIndex]!;
      if (
        physicalPathContains(left.physicalOutputDir, right.physicalOutputDir) ||
        physicalPathContains(right.physicalOutputDir, left.physicalOutputDir)
      ) {
        throw new TypeError(
          `Asset output directories must not overlap: ${left.stage} and ${right.stage}`,
        );
      }
    }
  }
}

export interface TailwindBatchOptions {
  enabled?: boolean;
  projectDir: string;
  sourceDir?: string;
  outputDir?: string;
}

export interface AssetPipelineOptions {
  images?: ImageOptimizationOptions;
  css?: (CSSOptimizationOptions & { enabled?: boolean }) | undefined;
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

export async function runAssetPipeline(
  options: AssetPipelineOptions = {},
): Promise<AssetPipelineResult> {
  const startTime = Date.now();

  logger.info("Starting asset pipeline");

  // Every enabled stage publishes independently. Preflight their physical
  // destinations before the first write so a later atomic directory swap
  // cannot erase another stage's output (including through symlink aliases).
  await validateAssetOutputPlan(options);

  const result: AssetPipelineResult = {
    images: { optimized: 0, variants: 0, totalSize: 0, enabled: false },
    css: { optimized: 0, originalSize: 0, minifiedSize: 0, savings: 0, enabled: false },
    tailwind: { processed: 0, utilities: 0, enabled: false },
    duration: 0,
  };

  if (options.images !== undefined && options.images.enabled !== false) {
    try {
      const imageOptimizer = new ImageOptimizer(options.images);
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
    } catch (error) {
      logger.error("Image optimization failed", { error: getErrorMessage(error) });
      throw error;
    }
  }

  const tailwindOptions = options.tailwind;
  if (tailwindOptions && tailwindOptions.enabled !== false) {
    const {
      projectDir,
      sourceDir = "styles",
      outputDir = DEFAULT_TAILWIND_OUTPUT_DIR,
    } = tailwindOptions;

    if (!projectDir) {
      logger.warn("Tailwind CSS processing skipped: projectDir not provided");
    } else {
      try {
        const tailwindResults: TailwindProcessResult[] = await processTailwindCSSInDirectory(
          projectDir,
          sourceDir,
          outputDir,
        );

        result.tailwind.enabled = true;

        if (tailwindResults.length === 0) {
          logger.info("Tailwind CSS processing skipped - no Tailwind files detected", {
            directory: sourceDir,
          });
        } else {
          const totalUtilities = tailwindResults.reduce(
            (sum, r) => sum + (r.detectedUtilities ?? 0),
            0,
          );

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
      } catch (error) {
        logger.error("Tailwind CSS processing failed", { error: getErrorMessage(error) });
        throw error;
      }
    }
  }

  if (options.css !== undefined && options.css.enabled !== false) {
    try {
      const cssOptimizer = new CSSOptimizer(options.css);
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
    } catch (error) {
      logger.error("CSS optimization failed", { error: getErrorMessage(error) });
      throw error;
    }
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

export async function checkAssetPipelineDependencies(): Promise<{
  sharp: boolean;
  lightningCSS: boolean;
}> {
  const dependencies = { sharp: false, lightningCSS: false };

  try {
    await import("https://esm.sh/sharp@0.33.0");
    dependencies.sharp = true;
  } catch (error) {
    logger.debug("Sharp image processing library not available:", error);
  }

  const configuredCSSOptimizer = tryResolve<unknown>(
    CSSOptimizationEngineName,
  );
  if (configuredCSSOptimizer !== undefined) {
    try {
      captureCSSOptimizationEngine(configuredCSSOptimizer);
      dependencies.lightningCSS = true;
    } catch (error) {
      logger.debug("Configured CSS optimization engine is invalid:", error);
    }
  }

  return dependencies;
}

export async function getAssetPipelineStatus(): Promise<{
  available: string[];
  missing: string[];
  recommendations: string[];
}> {
  const deps = await checkAssetPipelineDependencies();

  const available: string[] = [];
  const missing: string[] = [];
  const recommendations: string[] = [];

  if (deps.sharp) {
    available.push("Sharp image optimizer");
  } else {
    missing.push("Sharp");
    recommendations.push("Install Sharp for automatic image optimization: npm install sharp");
  }

  if (deps.lightningCSS) {
    available.push("Lightning CSS optimizer");
  } else {
    missing.push("Lightning CSS");
    recommendations.push(
      "Install and explicitly compose @veryfront/ext-css-lightning for CSS optimization",
    );
  }

  return { available, missing, recommendations };
}
