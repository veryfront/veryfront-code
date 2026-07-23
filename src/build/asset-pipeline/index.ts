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

import { type CSSOptimizationOptions, CSSOptimizer } from "./css-optimizer/index.ts";
import { type ImageOptimizationOptions, ImageOptimizer } from "./image-optimizer/index.ts";
import {
  processTailwindCSSInDirectory,
  type TailwindProcessResult,
} from "./tailwind-processor/index.ts";
import { logger } from "#veryfront/utils";
import { loadSharp } from "./image-optimizer/sharp-loader.ts";

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

  const result: AssetPipelineResult = {
    images: { optimized: 0, variants: 0, totalSize: 0, enabled: false },
    css: { optimized: 0, originalSize: 0, minifiedSize: 0, savings: 0, enabled: false },
    tailwind: { processed: 0, utilities: 0, enabled: false },
    duration: 0,
  };

  if (options.images && options.images.enabled !== false) {
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
  }

  const tailwindOptions = options.tailwind;
  if (tailwindOptions && tailwindOptions.enabled !== false) {
    const { projectDir, sourceDir = "styles", outputDir = ".veryfront/css" } = tailwindOptions;

    if (!projectDir?.trim()) {
      throw new TypeError("tailwind.projectDir must not be blank");
    }
    const tailwindResults: TailwindProcessResult[] = await processTailwindCSSInDirectory(
      projectDir,
      sourceDir,
      outputDir,
    );

    result.tailwind.enabled = true;

    if (tailwindResults.length === 0) {
      logger.info("Tailwind CSS processing skipped because no Tailwind files were detected");
    } else {
      const totalUtilities = tailwindResults.reduce(
        (sum, tailwindResult) => sum + tailwindResult.detectedUtilities,
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
  }

  if (options.css && options.css.enabled !== false) {
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
    await loadSharp();
    dependencies.sharp = true;
  } catch {
    logger.debug("Sharp image processing library is not available");
  }

  try {
    await import("npm:lightningcss@1.29.2");
    dependencies.lightningCSS = true;
  } catch {
    logger.debug("Lightning CSS is not available");
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
    recommendations.push("Install a Sharp binary compatible with the current runtime");
  }

  if (deps.lightningCSS) {
    available.push("Lightning CSS optimizer");
  } else {
    missing.push("Lightning CSS");
    recommendations.push(
      "Install Lightning CSS 1.29.2 in the current runtime",
    );
  }

  return { available, missing, recommendations };
}
