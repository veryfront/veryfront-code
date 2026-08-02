import React from "react";
import type { OptimizedImageMetadata } from "#veryfront/types";
import { useOptimizedImageMetadata } from "../../runtime/core.ts";
import { assertImageQuality, getOptimizedPath } from "./helpers.ts";

type Props = {
  src: string;
  metadata?: OptimizedImageMetadata;
  children?: React.ReactNode;
  format?: "webp" | "avif" | "jpeg" | "png";
  quality?: number;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

export function OptimizedBackgroundImage({
  src,
  metadata,
  children,
  format,
  quality,
  size,
  className,
  style,
}: Props): React.JSX.Element {
  const resolvedMetadata = useOptimizedImageMetadata(src, metadata);
  assertImageQuality(resolvedMetadata, quality);
  const optimizedSrc = getOptimizedPath(
    src,
    resolvedMetadata,
    format ?? resolvedMetadata.defaultFormat,
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
