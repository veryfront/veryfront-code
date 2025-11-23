import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "@veryfront/utils/constants/network.ts";
import { getOptimizedPath } from "./helpers.ts";

export function OptimizedBackgroundImage({
  src,
  children,
  format = "webp",
  quality = 80,
  size = RESPONSIVE_IMAGE_WIDTH_LG,
  className,
  style,
}: {
  src: string;
  children?: React.ReactNode;
  format?: "webp" | "avif" | "jpeg" | "png";
  quality?: number;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const optimizedSrc = getOptimizedPath(src, format, size, quality);

  const bgStyle: React.CSSProperties = {
    backgroundImage: `url(${optimizedSrc})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    ...style,
  };

  return (
    // @ts-ignore - csstype version conflict between dependencies
    <div className={className} style={bgStyle}>
      {children}
    </div>
  );
}
