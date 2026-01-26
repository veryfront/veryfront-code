/**
 * Consolidated asset utility functions for build pipeline
 * Merges CSS, Image, and Tailwind processor utilities
 */
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.js";
import { getOptimizedImageFormat, type ImageFormat, isImageFile as checkIsImage } from "./file-types.js";
export declare const CSS_EXTENSIONS: string[];
export declare function findCSSFiles(dir: string): Promise<string[]>;
export declare function globFiles(pattern: string): Promise<string[]>;
export declare function isPseudoSelector(selector: string): boolean;
export declare function getStandardPseudoSelectors(): string[];
export declare function getVariantPath(outputDir: string, relPath: string, format: ImageFormat, size: number): string;
export declare function generateSrcSet(_imagePath: string, metadata: OptimizedImageMetadata, outputDir: string, format?: ImageFormat): string;
export declare function calculateAspectRatio(width: number | undefined, height: number | undefined): number;
export declare const getOptimizedFormat: typeof getOptimizedImageFormat;
export declare const isImageFile: typeof checkIsImage;
export declare function getImageDimensions(metadata: OptimizedImageMetadata): {
    width: number;
    height: number;
};
//# sourceMappingURL=asset-utils.d.ts.map