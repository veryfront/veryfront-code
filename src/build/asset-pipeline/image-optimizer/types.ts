import type { ImageOptimizationFormat } from "#veryfront/extensions/image/index.ts";
export type {
  ImageVariant,
  OptimizedImageManifestRenderSession,
  OptimizedImageManifestSnapshot,
  OptimizedImageMetadata,
} from "#veryfront/types";

export type ImageFormat = ImageOptimizationFormat;

export interface ImageOptimizationOptions {
  enabled?: boolean;
  /** Absolute project boundary for input and output paths. */
  projectDir?: string;
  formats?: ImageFormat[];
  sizes?: number[];
  quality?: number;
  inputDir?: string;
  outputDir?: string;
  preserveOriginal?: boolean;
}

export interface ImageOptimizationStats {
  totalImages: number;
  totalVariants: number;
  totalSize: number;
  averageVariantSize: number;
  /**
   * @deprecated This legacy field was historically an alias for average
   * variant size, despite its name. Use `averageVariantSize`.
   */
  averageSavings: number;
}
