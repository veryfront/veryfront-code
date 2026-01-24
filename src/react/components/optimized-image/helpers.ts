export function getOptimizedPath(
  src: string,
  format: string,
  size: number,
  _quality: number = 80,
): string {
  const basePath = src.replace(/\.[^.]+$/, "");
  const optimizedDir = ".veryfront/optimized-images";
  return `/${optimizedDir}${basePath}-${size}w.${format}`;
}

export function generateSrcSet(
  src: string,
  format: string,
  sizes: number[],
  quality: number,
): string {
  return sizes
    .map((size) => `${getOptimizedPath(src, format, size, quality)} ${size}w`)
    .join(", ");
}

export function getExtension(src: string): string {
  return src.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "jpeg";
}
