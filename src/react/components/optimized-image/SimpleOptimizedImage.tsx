import type React from "react";
import type { OptimizedImageProps } from "./OptimizedImage.tsx";
import { useOptimizedImageMetadata } from "../../runtime/core.ts";
import { assertImageQuality, generateSrcSet, getOptimizedPath } from "./helpers.ts";

export function SimpleOptimizedImage({
  src,
  metadata,
  alt,
  width,
  height,
  format,
  quality,
  loading = "lazy",
  className,
  style,
  onClick,
  onLoad,
  onError,
}: Omit<OptimizedImageProps, "formats" | "sizes" | "priority" | "placeholder" | "blurDataURL"> & {
  format?: "webp" | "avif" | "jpeg" | "png";
}): React.JSX.Element {
  const resolvedMetadata = useOptimizedImageMetadata(src, metadata);
  assertImageQuality(resolvedMetadata, quality);
  const selectedFormat = format ?? resolvedMetadata.defaultFormat;
  const srcSet = generateSrcSet(src, resolvedMetadata, selectedFormat);
  const optimizedSrc = getOptimizedPath(src, resolvedMetadata, selectedFormat, width);

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
