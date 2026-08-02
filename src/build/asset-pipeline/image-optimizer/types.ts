export type ImageFormat = "webp" | "avif" | "jpeg" | "png";

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

export interface OptimizedImageMetadata {
  original: string;
  /** Source file size in bytes. */
  originalSize: number;
  variants: ImageVariant[];
  defaultFormat: ImageFormat;
  aspectRatio: number;
  /** Stable identity of the extension engine that produced these bytes. */
  engineIdentity: string;
  /** Encoding quality applied to every emitted variant. */
  quality: number;
}

export interface ImageVariant {
  format: ImageFormat;
  size: number;
  width: number;
  height: number;
  path: string;
  fileSize: number;
  /** Exact encoding quality used for this variant. */
  quality: number;
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
