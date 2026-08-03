import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "#veryfront/utils/constants/network.ts";
import { generateSrcSet, getImageExtension, getOptimizedPath } from "./helpers.ts";

// Must match the widths the build pipeline actually emits.
const DEFAULT_SIZES = [...IMAGE_OPTIMIZATION.DEFAULT_SIZES];
const DEFAULT_FORMATS: Array<"avif" | "webp" | "jpeg"> = ["avif", "webp", "jpeg"];

type ImageFormat = "avif" | "webp" | "jpeg" | "png";

export function useOptimizedImage(
  src: string,
  options: { formats?: ImageFormat[]; quality?: number } = {},
): {
  sources: Array<{ format: ImageFormat; srcSet: string; type: string }>;
  fallback: string;
} {
  const { formats = DEFAULT_FORMATS, quality = 80 } = options;

  const sources = formats.map((format) => ({
    format,
    srcSet: generateSrcSet(src, format, DEFAULT_SIZES, quality),
    type: `image/${format}`,
  }));

  const fallback = getOptimizedPath(
    src,
    getImageExtension(src),
    RESPONSIVE_IMAGE_WIDTH_LG,
    quality,
  );

  return { sources, fallback };
}
