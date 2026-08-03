import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "#veryfront/utils/constants/network.ts";
import { getOptimizedImageFallback, getOptimizedImageVariantWidths } from "./helpers.ts";
import type { OptimizedImageFormat } from "./OptimizedImage.tsx";

export interface OptimizedBackgroundImageProps {
  src: string;
  children?: React.ReactNode;
  format?: OptimizedImageFormat;
  quality?: number;
  /** Preferred rendered width. The nearest emitted width at or above it is selected. */
  size?: number;
  /** Intrinsic source width. The original asset is used when this is unknown. */
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
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths);
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
        backgroundImage: `url(${optimizedSrc})`,
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
