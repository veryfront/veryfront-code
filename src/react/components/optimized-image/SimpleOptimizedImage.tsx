import _React from "react";
import type { OptimizedImageProps } from "./OptimizedImage.tsx";
import { RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS } from "@veryfront/utils";
import { generateSrcSet, getOptimizedPath } from "./helpers.ts";

const DEFAULT_SIZES = [...RESPONSIVE_IMAGE_WIDTHS];

export function SimpleOptimizedImage({
  src,
  alt,
  width,
  height,
  format = "webp",
  quality = 80,
  loading = "lazy",
  className,
  style,
  onClick,
  onLoad,
  onError,
}: Omit<OptimizedImageProps, "formats" | "sizes" | "priority" | "placeholder" | "blurDataURL"> & {
  format?: "webp" | "avif" | "jpeg" | "png";
}) {
  const srcSet = generateSrcSet(src, format, DEFAULT_SIZES, quality);

  return (
    <img
      src={getOptimizedPath(src, format, width || RESPONSIVE_IMAGE_WIDTH_LG, quality)}
      srcSet={srcSet}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      className={className}
      // @ts-ignore - csstype version conflict between dependencies
      style={style}
      onClick={onClick}
      onLoad={onLoad}
      onError={onError}
    />
  );
}
