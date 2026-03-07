export interface SharpMetadata {
  width?: number;
  height?: number;
  format?: string;
  size?: number;
  space?: string;
  channels?: number;
  depth?: string;
  density?: number;
  chromaSubsampling?: string;
  isProgressive?: boolean;
  hasProfile?: boolean;
  hasAlpha?: boolean;
}

type SharpResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";

interface SharpResizeOptions {
  fit?: SharpResizeFit;
  withoutEnlargement?: boolean;
}

interface SharpWebpOptions {
  quality?: number;
}

interface SharpAvifOptions {
  quality?: number;
}

interface SharpJpegOptions {
  quality?: number;
  progressive?: boolean;
}

interface SharpPngOptions {
  compressionLevel?: number;
  adaptiveFiltering?: boolean;
}

export interface SharpInstance {
  metadata(): Promise<SharpMetadata>;
  clone(): SharpInstance;
  resize(
    width: number | null,
    height?: number | null,
    options?: SharpResizeOptions,
  ): SharpInstance;
  webp(options?: SharpWebpOptions): SharpInstance;
  avif(options?: SharpAvifOptions): SharpInstance;
  jpeg(options?: SharpJpegOptions): SharpInstance;
  png(options?: SharpPngOptions): SharpInstance;
  toBuffer(): Promise<Uint8Array>;
}

export type SharpConstructor = (input: Uint8Array) => SharpInstance;

export type ImageFormat = "webp" | "avif" | "jpeg" | "png";

export interface ImageOptimizationOptions {
  enabled?: boolean;
  formats?: ImageFormat[];
  sizes?: number[];
  quality?: number;
  inputDir?: string;
  outputDir?: string;
  preserveOriginal?: boolean;
}

export interface OptimizedImageMetadata {
  original: string;
  variants: ImageVariant[];
  defaultFormat: string;
  aspectRatio: number;
}

export interface ImageVariant {
  format: ImageFormat;
  size: number;
  width: number;
  height: number;
  path: string;
  fileSize: number;
}

export interface ImageOptimizationStats {
  totalImages: number;
  totalVariants: number;
  totalSize: number;
  averageSavings: number;
}
