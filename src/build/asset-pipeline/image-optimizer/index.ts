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

export function optimizeImages(
  options: ImageOptimizationOptions = {},
): Promise<Map<string, OptimizedImageMetadata>> {
  const optimizer = new ImageOptimizer(options);
  return optimizer.optimize();
}
