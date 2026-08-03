import {
  generateSrcSet,
  getImageExtension,
  getOptimizedImageFallback,
  getOptimizedImageVariantWidths,
} from "./helpers.ts";

const DEFAULT_FORMATS: Array<"avif" | "webp" | "jpeg"> = ["avif", "webp", "jpeg"];

type ImageFormat = "avif" | "webp" | "jpeg" | "png";

export function useOptimizedImage(
  src: string,
  options: { formats?: ImageFormat[]; quality?: number; width?: number } = {},
): {
  sources: Array<{ format: ImageFormat; srcSet: string; type: string }>;
  fallback: string;
} {
  const { formats = DEFAULT_FORMATS, quality = 80, width } = options;
  const variantWidths = getOptimizedImageVariantWidths(width);

  const sources = variantWidths.length === 0 ? [] : formats.map((format) => ({
    format,
    srcSet: generateSrcSet(src, format, variantWidths, quality),
    type: `image/${format}`,
  }));

  const fallback = getOptimizedImageFallback(
    src,
    getImageExtension(src),
    variantWidths,
    quality,
  );

  return { sources, fallback };
}
