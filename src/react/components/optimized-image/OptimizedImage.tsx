import React from "react";
import { RESPONSIVE_IMAGE_WIDTH_LG, RESPONSIVE_IMAGE_WIDTHS } from "#veryfront/utils";
import { generateSrcSet, getImageExtension, getOptimizedPath } from "./helpers.ts";

export interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  formats?: ("avif" | "webp" | "jpeg" | "png")[];
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

const DEFAULT_SIZES = RESPONSIVE_IMAGE_WIDTHS;
const DEFAULT_FORMATS: ("avif" | "webp" | "jpeg")[] = ["avif", "webp", "jpeg"];

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  sizes = "100vw",
  formats = DEFAULT_FORMATS,
  quality = 80,
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
  const loadingStrategy = priority ? "eager" : (loading ?? "lazy");
  const originalFormat = getImageExtension(src);

  const imgStyle: React.CSSProperties = {
    ...style,
    ...(placeholder === "blur" && blurDataURL
      ? { backgroundImage: `url(${blurDataURL})`, backgroundSize: "cover" }
      : {}),
  };

  return (
    <picture>
      {formats.map((format) => (
        <source
          key={format}
          type={`image/${format}`}
          srcSet={generateSrcSet(src, format, DEFAULT_SIZES, quality)}
          sizes={sizes}
        />
      ))}

      <img
        src={getOptimizedPath(src, originalFormat, width ?? RESPONSIVE_IMAGE_WIDTH_LG, quality)}
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
