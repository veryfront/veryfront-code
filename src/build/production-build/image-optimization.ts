/** Production-build integration for explicit image optimization engines. */

import { join, resolve } from "#veryfront/compat/path/index.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { ImageOptimizer } from "../asset-pipeline/image-optimizer/optimizer-core.ts";
import { IMAGE_ASSET_PUBLIC_PATH } from "../asset-pipeline/image-optimizer/constants.ts";
import type { ImageOptimizationSession } from "../asset-pipeline/image-optimizer/optimization-engine.ts";
import type { ImageOptimizationStats } from "../asset-pipeline/image-optimizer/types.ts";
import type { ImageOptimizationOptions } from "../asset-pipeline/image-optimizer/types.ts";
import {
  createOptimizedImageManifestResolver,
  type OptimizedImageManifestResolver,
} from "../asset-pipeline/image-optimizer/render-manifest.ts";

export interface ProductionImageOptimizationOptions {
  readonly projectDir: string;
  readonly outputDir: string;
  readonly config?: VeryfrontConfig;
  readonly dryRun: boolean;
}

export interface ProductionImageOptimizationDependencies {
  readonly optimizationSession?: ImageOptimizationSession;
  readonly signal?: AbortSignal;
}

export interface ProductionImageOptimizationResult {
  readonly stats: ImageOptimizationStats;
  readonly manifestResolver?: OptimizedImageManifestResolver;
}

const DISABLED_STATS: ImageOptimizationStats = Object.freeze({
  totalImages: 0,
  totalVariants: 0,
  totalSize: 0,
  averageVariantSize: 0,
  averageSavings: 0,
});

/**
 * Optimize project images into the atomic build tree.
 *
 * The public URL is fixed by the framework protocol. User-configurable input,
 * formats, sizes, quality, and original preservation remain supported.
 */
export async function optimizeProductionImages(
  options: ProductionImageOptimizationOptions,
  dependencies: ProductionImageOptimizationDependencies = {},
): Promise<ProductionImageOptimizationResult> {
  const configured = options.config?.assetPipeline?.images;
  if (configured === undefined || configured.enabled === false) {
    return { stats: { ...DISABLED_STATS } };
  }

  if (
    configured.projectDir !== undefined &&
    resolve(configured.projectDir) !== resolve(options.projectDir)
  ) {
    throw new TypeError(
      "Production image optimization projectDir must match the build project",
    );
  }
  if (configured.outputDir !== undefined) {
    throw new TypeError(
      `Production image optimization publishes at ${IMAGE_ASSET_PUBLIC_PATH}; remove assetPipeline.images.outputDir`,
    );
  }

  const outputDir = join(options.outputDir, "_vf", "assets", "images");
  const imageOptions = configured as ImageOptimizationOptions;
  const optimizer = new ImageOptimizer(
    {
      ...imageOptions,
      projectDir: options.projectDir,
      outputDir,
    },
    {
      optimizationSession: dependencies.optimizationSession,
      outputBoundary: options.outputDir,
      publicPath: IMAGE_ASSET_PUBLIC_PATH,
      signal: dependencies.signal,
    },
  );

  // Dry runs execute the full engine contract and manifest validation without
  // publishing output, so they exercise the same render-time metadata path.
  const manifest = options.dryRun ? await optimizer.preview() : await optimizer.optimize();
  return {
    stats: optimizer.getStats(),
    manifestResolver: await createOptimizedImageManifestResolver(manifest),
  };
}
