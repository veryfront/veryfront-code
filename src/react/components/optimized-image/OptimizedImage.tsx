import React from "react";
import {
  generateSrcSet,
  getImageExtension,
  getOptimizedImageFallback,
  getOptimizedImageVariantWidths,
} from "./helpers.ts";

export interface OptimizedImageProps {
  src: string;
  alt: string;
  /** Intrinsic source width. Optimized variants are used only when this is known. */
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
  const variantWidths = getOptimizedImageVariantWidths(width);

  const imgStyle: React.CSSProperties = {
    ...style,
    ...(placeholder === "blur" && blurDataURL
      ? { backgroundImage: `url(${blurDataURL})`, backgroundSize: "cover" }
      : {}),
  };

  return (
    <picture>
      {variantWidths.length > 0 && formats.map((format) => (
        <source
          key={format}
          type={`image/${format}`}
          srcSet={generateSrcSet(src, format, variantWidths, quality)}
          sizes={sizes}
        />
      ))}

      <img
        src={getOptimizedImageFallback(src, originalFormat, variantWidths, quality)}
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
