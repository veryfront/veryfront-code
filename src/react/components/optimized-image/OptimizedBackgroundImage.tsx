import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "#veryfront/utils/constants/network.ts";
import { cssUrl, getOptimizedImageFallback, getOptimizedImageVariantWidths } from "./helpers.ts";
import type { OptimizedImageFormat } from "./OptimizedImage.tsx";

export interface OptimizedBackgroundImageProps {
  /** App asset path. URL suffixes are ignored when resolving build-emitted variants. */
  src: string;
  children?: React.ReactNode;
  /** Must match `assetPipeline.images.formats` when custom build formats are configured. */
  format?: OptimizedImageFormat;
  quality?: number;
  /** Preferred rendered width. Uses the nearest emitted width at or above it, or the largest emitted width. */
  size?: number;
  /** Intrinsic source width. The original asset is used when this is missing or invalid. */
  width?: number;
  /** Must match `assetPipeline.images.sizes` when custom build widths are configured. */
  targetWidths?: readonly number[];
  className?: string;
  style?: React.CSSProperties;
}

export function OptimizedBackgroundImage({
  src,
  children,
  format = "webp",
  quality = 80,
  size = RESPONSIVE_IMAGE_WIDTH_LG,
  width,
  targetWidths,
  className,
  style,
}: OptimizedBackgroundImageProps): React.JSX.Element {
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths, src);
  const optimizedSrc = getOptimizedImageFallback(
    src,
    format,
    variantWidths,
    quality,
    size,
  );

  return (
    <div
      className={className}
      style={{
        backgroundImage: cssUrl(optimizedSrc),
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
