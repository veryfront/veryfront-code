import { getExtensionName } from "#veryfront/utils/path-utils.ts";

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
