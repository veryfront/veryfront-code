import {
  DEFAULT_OPTIMIZED_IMAGE_FORMATS,
  generateSrcSet,
  getImageExtension,
  getOptimizedImageFormatFallback,
  getOptimizedImageVariantWidths,
} from "./helpers.ts";
import type { OptimizedImageFormat } from "./OptimizedImage.tsx";

export interface UseOptimizedImageOptions {
  /** Must match `assetPipeline.images.formats` when custom build formats are configured. */
  formats?: readonly OptimizedImageFormat[];
  quality?: number;
  /** Intrinsic source width. Missing or invalid values use the original asset. */
  width?: number;
  /** Must match `assetPipeline.images.sizes` when custom build widths are configured. */
  targetWidths?: readonly number[];
}

export function useOptimizedImage(
  src: string,
  options: UseOptimizedImageOptions = {},
): {
  sources: Array<{ format: OptimizedImageFormat; srcSet: string; type: string }>;
  fallback: string;
} {
  const { formats = DEFAULT_OPTIMIZED_IMAGE_FORMATS, quality = 80, targetWidths, width } = options;
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths, src);

  const sources = variantWidths.length === 0 ? [] : formats.map((format) => ({
    format,
    srcSet: generateSrcSet(src, format, variantWidths, quality),
    type: `image/${format}`,
  }));

  const fallback = getOptimizedImageFormatFallback(
    src,
    getImageExtension(src),
    formats,
    variantWidths,
    quality,
  );

  return { sources, fallback };
}
