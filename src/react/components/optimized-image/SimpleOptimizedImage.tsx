import type React from "react";
import type { OptimizedImageFormat, OptimizedImageProps } from "./OptimizedImage.tsx";
import {
  generateSrcSet,
  getImageDimensionAttribute,
  getOptimizedImageFallback,
  getOptimizedImageVariantWidths,
} from "./helpers.ts";

export function SimpleOptimizedImage({
  src,
  alt,
  width,
  height,
  sizes = "100vw",
  targetWidths,
  format = "webp",
  quality = 80,
  loading = "lazy",
  className,
  style,
  onClick,
  onLoad,
  onError,
}: Omit<OptimizedImageProps, "formats" | "priority" | "placeholder" | "blurDataURL"> & {
  /** Must match `assetPipeline.images.formats` when custom build formats are configured. */
  format?: OptimizedImageFormat;
}): React.JSX.Element {
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths, src);
  const srcSet = variantWidths.length > 0
    ? generateSrcSet(src, format, variantWidths, quality)
    : undefined;
  const optimizedSrc = getOptimizedImageFallback(src, format, variantWidths, quality);
  const imageWidth = getImageDimensionAttribute(width);
  const imageHeight = getImageDimensionAttribute(height);

  return (
    <img
      src={optimizedSrc}
      srcSet={srcSet}
      sizes={srcSet === undefined ? undefined : sizes}
      alt={alt}
      width={imageWidth}
      height={imageHeight}
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
