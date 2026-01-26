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
export type SharpResizeFit = "cover" | "contain" | "fill" | "inside" | "outside";
export interface SharpResizeOptions {
    fit?: SharpResizeFit;
    withoutEnlargement?: boolean;
}
export interface SharpWebpOptions {
    quality?: number;
}
export interface SharpAvifOptions {
    quality?: number;
}
export interface SharpJpegOptions {
    quality?: number;
    progressive?: boolean;
}
export interface SharpPngOptions {
    compressionLevel?: number;
    adaptiveFiltering?: boolean;
}
export interface SharpInstance {
    metadata(): Promise<SharpMetadata>;
    clone(): SharpInstance;
    resize(width: number | null, height?: number | null, options?: SharpResizeOptions): SharpInstance;
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
//# sourceMappingURL=types.d.ts.map