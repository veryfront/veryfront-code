import type { ImageFormat, ImageOptimizationOptions, ImageOptimizationStats, OptimizedImageMetadata } from "./types.js";
export declare class ImageOptimizer {
    private options;
    private sharp;
    private imageManifest;
    private fs;
    constructor(options?: ImageOptimizationOptions);
    init(): Promise<boolean>;
    optimize(): Promise<Map<string, OptimizedImageMetadata>>;
    private optimizeImage;
    getImageMetadata(imagePath: string): OptimizedImageMetadata | null;
    generateSrcSet(imagePath: string, format?: ImageFormat): string;
    private getTotalVariants;
    getStats(): ImageOptimizationStats;
}
//# sourceMappingURL=optimizer-core.d.ts.map