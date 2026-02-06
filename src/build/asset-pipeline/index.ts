export * from "./css-optimizer/index.ts";

import { type CSSOptimizationOptions, CSSOptimizer } from "./css-optimizer/index.ts";
import { type ImageOptimizationOptions, ImageOptimizer } from "./image-optimizer/index.ts";
import {
  processTailwindCSSInDirectory,
  type TailwindProcessResult,
} from "./tailwind-processor/index.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { logger } from "#veryfront/utils";

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

  if (options.images?.enabled !== false) {
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
    }
  }

  const tailwindOptions = options.tailwind;
  if (tailwindOptions && tailwindOptions.enabled !== false) {
    const { projectDir, sourceDir = "styles", outputDir = ".veryfront/css" } = tailwindOptions;

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
      }
    }
  }

  if (options.css?.enabled !== false) {
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

  try {
    await import("https://esm.sh/lightningcss@1.22.0");
    dependencies.lightningCSS = true;
  } catch (error) {
    logger.debug("Lightning CSS not available:", error);
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
      "Install Lightning CSS for advanced CSS optimization: npm install lightningcss",
    );
  }

  return { available, missing, recommendations };
}
