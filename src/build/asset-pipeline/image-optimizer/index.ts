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
  return withSpan("build.asset.optimizeImages", () => {
    const optimizer = new ImageOptimizer(options);
    return optimizer.optimize();
  }, {
    "image.inputDir": options.inputDir ?? "default",
    "image.formats": options.formats?.join(",") ?? "default",
  });
}
