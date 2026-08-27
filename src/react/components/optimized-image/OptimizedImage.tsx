import React from "react";
import {
  DEFAULT_OPTIMIZED_IMAGE_FORMATS,
  generateSrcSet,
  getImageDimensionAttribute,
  getImageExtension,
  getOptimizedImageFormatFallback,
  getOptimizedImageVariantWidths,
  handleImageActivationBlur,
  handleImageActivationKeyDown,
  handleImageActivationKeyUp,
} from "./helpers.ts";

export type OptimizedImageFormat = "avif" | "webp" | "jpeg" | "png";

export interface OptimizedImageProps {
  /** App asset path. URL suffixes are ignored when resolving build-emitted variants. */
  src: string;
  alt: string;
  /** Intrinsic source width. Missing or invalid values use the original asset. */
  width?: number;
  height?: number;
  sizes?: string;
  /** Must match `assetPipeline.images.sizes` when custom build widths are configured. */
  targetWidths?: readonly number[];
  /** Must match `assetPipeline.images.formats` when custom build formats are configured. */
  formats?: readonly OptimizedImageFormat[];
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
  alt,
  width,
  height,
  sizes = "100vw",
  targetWidths,
  formats = DEFAULT_OPTIMIZED_IMAGE_FORMATS,
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
  const variantWidths = getOptimizedImageVariantWidths(width, targetWidths, src);
  const imageWidth = getImageDimensionAttribute(width);
  const imageHeight = getImageDimensionAttribute(height);

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
        src={getOptimizedImageFormatFallback(
          src,
          originalFormat,
          formats,
          variantWidths,
          quality,
        )}
        alt={alt}
        width={imageWidth}
        height={imageHeight}
        loading={loadingStrategy}
        decoding="async"
        className={className}
        style={imgStyle}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        onClick={onClick}
        onKeyDown={onClick ? handleImageActivationKeyDown : undefined}
        onKeyUp={onClick ? handleImageActivationKeyUp : undefined}
        onBlur={onClick ? handleImageActivationBlur : undefined}
        onLoad={onLoad}
        onError={onError}
      />
    </picture>
  );
}
