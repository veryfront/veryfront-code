import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import { resolveImageVariantWidths } from "#veryfront/utils/image-variant-widths.ts";

export function getOptimizedPath(
  src: string,
  format: string,
  size: number,
  _quality: number = 80,
): string {
  const basePath = src.replace(/\.[^.]+$/, "");
  return `/.veryfront/optimized-images${basePath}-${size}w.${format}`;
}

export function generateSrcSet(
  src: string,
  format: string,
  sizes: readonly number[],
  quality: number,
): string {
  return sizes
    .map((size) => `${getOptimizedPath(src, format, size, quality)} ${size}w`)
    .join(", ");
}

/** Resolve build-emitted widths when the source's intrinsic width is known. */
export function getOptimizedImageVariantWidths(
  sourceWidth: number | undefined,
): readonly number[] {
  return sourceWidth === undefined ? [] : resolveImageVariantWidths(sourceWidth);
}

/** Use the original asset unless a corresponding optimized variant is known. */
export function getOptimizedImageFallback(
  src: string,
  format: string,
  widths: readonly number[],
  quality: number,
): string {
  const width = widths[widths.length - 1];
  return width === undefined ? src : getOptimizedPath(src, format, width, quality);
}

/**
 * Get image file extension, defaulting to "jpeg" if none found.
 *
 * "jpg" is normalized to "jpeg" because the build pipeline only emits
 * "jpeg" variants (see SUPPORTED_FORMATS in the image optimizer), so a
 * ".jpg" source would otherwise produce a fallback URL that never exists.
 */
export function getImageExtension(src: string): string {
  const extension = getExtensionName(src) || "jpeg";
  return extension === "jpg" ? "jpeg" : extension;
}
