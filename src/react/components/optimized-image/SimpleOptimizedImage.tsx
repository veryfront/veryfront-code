import type React from "react";
import type { OptimizedImageProps } from "./OptimizedImage.tsx";
import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "#veryfront/utils/constants/network.ts";
import { generateSrcSet, getOptimizedPath } from "./helpers.ts";

// Must match the widths the build pipeline actually emits.
const DEFAULT_SIZES = IMAGE_OPTIMIZATION.DEFAULT_SIZES;

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
}): React.JSX.Element {
  const srcSet = generateSrcSet(src, format, DEFAULT_SIZES, quality);
  const optimizedSrc = getOptimizedPath(src, format, width ?? RESPONSIVE_IMAGE_WIDTH_LG, quality);

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
