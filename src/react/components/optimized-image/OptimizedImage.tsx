import React from "react";
import type { OptimizedImageMetadata } from "#veryfront/types";
import { useOptimizedImageMetadata } from "../../runtime/core.ts";
import {
  assertImageQuality,
  generateSrcSet,
  getAvailableFormats,
  getImageMimeType,
  getOptimizedPath,
} from "./helpers.ts";

export interface OptimizedImageProps {
  src: string;
  /** Exact entry from the generated image-manifest.json. */
  metadata?: OptimizedImageMetadata;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  formats?: readonly ("avif" | "webp" | "jpeg" | "png")[];
  quality?: number;
  loading?: "lazy" | "eager";
  priority?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: "blur" | "empty";
  blurDataURL?: string;
  onClick?: (event: React.MouseEvent<HTMLImageElement>) => void;
  onLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
  onError?: (event: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function OptimizedImage({
  src,
  metadata,
  alt,
  width,
  height,
  sizes = "100vw",
  formats,
  quality,
  loading,
  priority = false,
  className,
  style,
  placeholder = "empty",
  blurDataURL,
  onClick,
  onLoad,
  onError,
}: OptimizedImageProps): React.JSX.Element {
  const resolvedMetadata = useOptimizedImageMetadata(src, metadata);
  const loadingStrategy = priority ? "eager" : (loading ?? "lazy");
  assertImageQuality(resolvedMetadata, quality);
  const selectedFormats = formats ?? getAvailableFormats(resolvedMetadata);

  const imgStyle: React.CSSProperties = {
    ...style,
    ...(placeholder === "blur" && blurDataURL
      ? { backgroundImage: `url(${blurDataURL})`, backgroundSize: "cover" }
      : {}),
  };

  return (
    <picture>
      {selectedFormats.map((format) => (
        <source
          key={format}
          type={getImageMimeType(format)}
          srcSet={generateSrcSet(src, resolvedMetadata, format)}
          sizes={sizes}
        />
      ))}

      <img
        src={getOptimizedPath(
          src,
          resolvedMetadata,
          resolvedMetadata.defaultFormat,
          width,
        )}
        alt={alt}
        width={width}
        height={height}
        loading={loadingStrategy}
        decoding="async"
        className={className}
        style={imgStyle}
        onClick={onClick}
        onLoad={onLoad}
        onError={onError}
      />
    </picture>
  );
}
