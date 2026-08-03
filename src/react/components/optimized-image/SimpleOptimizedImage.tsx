import type React from "react";
import type { OptimizedImageFormat, OptimizedImageProps } from "./OptimizedImage.tsx";
import {
  generateSrcSet,
  getOptimizedImageFallback,
  getOptimizedImageVariantWidths,
} from "./helpers.ts";

export function SimpleOptimizedImage({
  src,
  alt,
  width,
  height,
  targetWidths,
  format = "webp",
  quality = 80,
  loading = "lazy",
  className,
  style,
  onClick,
  onLoad,
  onError,
}: Omit<OptimizedImageProps, "formats" | "sizes" | "priority" | "placeholder" | "blurDataURL"> & {
  format?: OptimizedImageFormat;
}): React.JSX.Element {
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths);
  const srcSet = variantWidths.length > 0
    ? generateSrcSet(src, format, variantWidths, quality)
    : undefined;
  const optimizedSrc = getOptimizedImageFallback(src, format, variantWidths, quality);

  return (
    <img
      src={optimizedSrc}
      srcSet={srcSet}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      className={className}
      style={style}
      onClick={onClick}
      onLoad={onLoad}
      onError={onError}
    />
  );
}
