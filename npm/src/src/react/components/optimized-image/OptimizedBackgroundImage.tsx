import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG } from "../../../utils/constants/network.js";
import { getOptimizedPath } from "./helpers.js";

type Props = {
  src: string;
  children?: React.ReactNode;
  format?: "webp" | "avif" | "jpeg" | "png";
  quality?: number;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function OptimizedBackgroundImage({
  src,
  children,
  format = "webp",
  quality = 80,
  size = RESPONSIVE_IMAGE_WIDTH_LG,
  className,
  style,
}: Props): React.JSX.Element {
  const optimizedSrc = getOptimizedPath(src, format, size, quality);

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
