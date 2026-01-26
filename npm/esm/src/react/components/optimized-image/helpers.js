export function getOptimizedPath(src, format, size, _quality = 80) {
    const basePath = src.replace(/\.[^.]+$/, "");
    const optimizedDir = ".veryfront/optimized-images";
    return `/${optimizedDir}${basePath}-${size}w.${format}`;
}
export function generateSrcSet(src, format, sizes, quality) {
    return sizes
        .map((size) => `${getOptimizedPath(src, format, size, quality)} ${size}w`)
        .join(", ");
}
export function getExtension(src) {
    return src.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "jpeg";
}
