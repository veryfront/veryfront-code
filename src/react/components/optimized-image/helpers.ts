import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import {
  isValidImageVariantWidth,
  resolveImageVariantWidths,
} from "#veryfront/utils/image-variant-widths.ts";

function sourcePath(src: string): string {
  const queryIndex = src.indexOf("?");
  const fragmentIndex = src.indexOf("#");
  let suffixIndex = src.length;
  if (queryIndex >= 0) suffixIndex = queryIndex;
  if (fragmentIndex >= 0 && fragmentIndex < suffixIndex) suffixIndex = fragmentIndex;
  return src.slice(0, suffixIndex).replaceAll("\\", "/");
}

function encodePathSegment(segment: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(segment));
  } catch {
    return encodeURIComponent(segment);
  }
}

export function getOptimizedPath(
  src: string,
  format: string,
  size: number,
  _quality: number = 80,
): string {
  const basePath = sourcePath(src).replace(/\.[^./]+$/, "");
  const encodedPath = basePath.split("/").map(encodePathSegment).join("/");
  return `/.veryfront/optimized-images${encodedPath}-${size}w.${format}`;
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
  targetWidths?: readonly number[],
): readonly number[] {
  if (!isValidImageVariantWidth(sourceWidth)) return [];
  if (targetWidths !== undefined) {
    for (let index = 0; index < targetWidths.length; index++) {
      if (!isValidImageVariantWidth(targetWidths[index])) return [];
    }
  }
  return targetWidths === undefined
    ? resolveImageVariantWidths(sourceWidth)
    : resolveImageVariantWidths(sourceWidth, targetWidths);
}

/** Use the original asset unless a corresponding optimized variant is known. */
export function getOptimizedImageFallback(
  src: string,
  format: string,
  widths: readonly number[],
  quality: number,
  preferredWidth?: number,
): string {
  let width = widths[widths.length - 1];
  if (preferredWidth !== undefined) {
    for (let index = 0; index < widths.length; index++) {
      if (widths[index]! >= preferredWidth) {
        width = widths[index];
        break;
      }
    }
  }
  return width === undefined ? src : getOptimizedPath(src, format, width, quality);
}

/** Use an optimized fallback only when the build emitted the source format. */
export function getOptimizedImageFormatFallback(
  src: string,
  format: string,
  emittedFormats: readonly string[] | undefined,
  widths: readonly number[],
  quality: number,
): string {
  if (emittedFormats === undefined) return src;
  for (let index = 0; index < emittedFormats.length; index++) {
    if (emittedFormats[index] === format) {
      return getOptimizedImageFallback(src, format, widths, quality);
    }
  }
  return src;
}

/**
 * Get image file extension, defaulting to "jpeg" if none found.
 *
 * "jpg" is normalized to "jpeg" because the build pipeline only emits
 * "jpeg" variants (see SUPPORTED_FORMATS in the image optimizer), so a
 * ".jpg" source would otherwise produce a fallback URL that never exists.
 */
export function getImageExtension(src: string): string {
  const extension = getExtensionName(sourcePath(src)) || "jpeg";
  return extension === "jpg" ? "jpeg" : extension;
}
