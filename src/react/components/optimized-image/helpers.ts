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
