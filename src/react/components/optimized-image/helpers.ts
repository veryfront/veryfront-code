import { IMAGE_OPTIMIZATION } from "#veryfront/utils/constants/build.ts";
import { normalizeOptimizedImageSourcePath } from "#veryfront/utils/optimized-image-manifest.ts";
import { getExtensionName } from "#veryfront/utils/path-utils.ts";
import type {
  ImageVariant,
  OptimizedImageFormat as ImageFormat,
  OptimizedImageMetadata,
} from "#veryfront/types";

function encodeVariantPath(path: string, publicPath: string): string {
  const encoded = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${publicPath}/${encoded}`;
}

function assertManifestMatchesSource(
  src: string,
  metadata: OptimizedImageMetadata,
): void {
  const sourcePath = normalizeOptimizedImageSourcePath(src);
  if (sourcePath !== metadata.original) {
    throw new TypeError(
      `Optimized image metadata for ${JSON.stringify(metadata.original)} does not match ${
        JSON.stringify(src)
      }`,
    );
  }
}

function variantsForFormat(
  metadata: OptimizedImageMetadata,
  format: ImageFormat,
): ImageVariant[] {
  const variants = metadata.variants
    .filter((variant) => variant.format === format)
    .sort((left, right) => left.width - right.width);
  if (variants.length === 0) {
    throw new TypeError(
      `Image manifest has no ${format} variant for ${JSON.stringify(metadata.original)}`,
    );
  }
  return variants;
}

export function assertImageQuality(
  metadata: OptimizedImageMetadata,
  requestedQuality: number | undefined,
): void {
  if (requestedQuality === undefined) return;
  if (
    !Number.isInteger(requestedQuality) ||
    requestedQuality < 1 ||
    requestedQuality > 100
  ) {
    throw new TypeError("Optimized image quality must be an integer from 1 through 100");
  }
  if (requestedQuality !== metadata.quality) {
    throw new TypeError(
      `Optimized image quality ${requestedQuality} was not produced; manifest quality is ${metadata.quality}`,
    );
  }
}

export function getAvailableFormats(
  metadata: OptimizedImageMetadata,
): ImageFormat[] {
  const formats: ImageFormat[] = [];
  for (const variant of metadata.variants) {
    if (!formats.includes(variant.format)) formats.push(variant.format);
  }
  return formats;
}

export function getOptimizedPath(
  src: string,
  metadata: OptimizedImageMetadata,
  format: ImageFormat,
  requestedWidth?: number,
  publicPath: string = IMAGE_OPTIMIZATION.PUBLIC_PATH,
): string {
  assertManifestMatchesSource(src, metadata);
  if (
    requestedWidth !== undefined &&
    (!Number.isFinite(requestedWidth) || requestedWidth <= 0)
  ) {
    throw new TypeError("Optimized image width must be a positive finite number");
  }
  const variants = variantsForFormat(metadata, format);
  const selected = requestedWidth === undefined
    ? variants[variants.length - 1]!
    : variants.find((variant) => variant.width >= requestedWidth) ??
      variants[variants.length - 1]!;
  return encodeVariantPath(selected.path, publicPath);
}

export function generateSrcSet(
  src: string,
  metadata: OptimizedImageMetadata,
  format: ImageFormat,
  publicPath: string = IMAGE_OPTIMIZATION.PUBLIC_PATH,
): string {
  assertManifestMatchesSource(src, metadata);
  return variantsForFormat(metadata, format)
    .map((variant) => `${encodeVariantPath(variant.path, publicPath)} ${variant.width}w`)
    .join(", ");
}

/** Get a normalized image extension, defaulting to jpeg. */
export function getImageExtension(src: string): ImageFormat {
  const extension = getExtensionName(src).toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "jpeg";
  if (extension === "png" || extension === "webp" || extension === "avif") {
    return extension;
  }
  return "jpeg";
}

export function getImageMimeType(format: ImageFormat): string {
  return format === "jpeg" ? "image/jpeg" : `image/${format}`;
}
