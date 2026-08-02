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
 */
export function getImageExtension(src: string): string {
  return getExtensionName(src) || "jpeg";
}
