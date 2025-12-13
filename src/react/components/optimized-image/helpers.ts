/**
 * Generates the path for an optimized image.
 * @param src - Original image source path
 * @param format - Target image format (e.g., 'webp', 'avif', 'jpeg')
 * @param size - Target width in pixels
 * @param quality - Image quality (currently unused, reserved for future CDN integration)
 * @returns The path to the optimized image
 */
export function getOptimizedPath(
  src: string,
  format: string,
  size: number,
  quality: number = 80,
): string {
  // Validate inputs
  if (!src || typeof src !== "string") {
    return "";
  }

  const basePath = src.replace(/\.[^.]+$/, "");
  const optimizedDir = ".veryfront/optimized-images";

  // Quality parameter reserved for future CDN query string support
  // e.g., `/${optimizedDir}${basePath}-${size}w.${format}?q=${quality}`
  void quality;

  return `/${optimizedDir}${basePath}-${size}w.${format}`;
}

export function generateSrcSet(
  src: string,
  format: string,
  sizes: number[],
  quality: number,
): string {
  return sizes
    .map((size) => {
      const path = getOptimizedPath(src, format, size, quality);
      return `${path} ${size}w`;
    })
    .join(", ");
}

export function getExtension(src: string): string {
  const match = src.match(/\.([^.]+)$/);
  const extension = match?.[1];
  return extension ? extension.toLowerCase() : "jpeg";
}
