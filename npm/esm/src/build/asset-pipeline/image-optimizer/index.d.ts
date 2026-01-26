export type { ImageFormat, ImageOptimizationOptions, ImageOptimizationStats, ImageVariant, OptimizedImageMetadata, } from "./types.js";
export { ImageOptimizer } from "./optimizer-core.js";
export { loadManifest as loadImageManifest } from "./manifest-manager.js";
import type { ImageOptimizationOptions, OptimizedImageMetadata } from "./types.js";
export declare function optimizeImages(options?: ImageOptimizationOptions): Promise<Map<string, OptimizedImageMetadata>>;
//# sourceMappingURL=index.d.ts.map