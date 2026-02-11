/**
 * Asset Pipeline - Image Optimizer
 *
 * @module build/asset-pipeline/image-optimizer
 */

export type {
  ImageFormat,
  ImageOptimizationOptions,
  ImageOptimizationStats,
  ImageVariant,
  OptimizedImageMetadata,
} from "./types.ts";

export { ImageOptimizer } from "./optimizer-core.ts";
export { loadManifest as loadImageManifest } from "./manifest-manager.ts";

import { ImageOptimizer } from "./optimizer-core.ts";
import type { ImageOptimizationOptions, OptimizedImageMetadata } from "./types.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export function optimizeImages(
  options: ImageOptimizationOptions = {},
): Promise<Map<string, OptimizedImageMetadata>> {
  const inputDir = options.inputDir ?? "default";
  const formats = options.formats?.join(",") ?? "default";

  return withSpan(
    "build.asset.optimizeImages",
    () => new ImageOptimizer(options).optimize(),
    {
      "image.inputDir": inputDir,
      "image.formats": formats,
    },
  );
}
