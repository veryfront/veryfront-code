import type {
  ImageFormat,
  OptimizedImageMetadata,
} from "#veryfront/build/asset-pipeline/image-optimizer/types.ts";
import { useOptimizedImageMetadata as useManifestMetadata } from "../../runtime/core.ts";
import {
  assertImageQuality,
  generateSrcSet,
  getAvailableFormats,
  getImageMimeType,
  getOptimizedPath,
} from "./helpers.ts";

export function useOptimizedImage(
  src: string,
  metadata?: OptimizedImageMetadata,
  options: { formats?: ImageFormat[]; quality?: number } = {},
): {
  sources: Array<{ format: ImageFormat; srcSet: string; type: string }>;
  fallback: string;
} {
  const resolvedMetadata = useManifestMetadata(src, metadata);
  const { formats = getAvailableFormats(resolvedMetadata), quality } = options;
  assertImageQuality(resolvedMetadata, quality);

  const sources = formats.map((format) => ({
    format,
    srcSet: generateSrcSet(src, resolvedMetadata, format),
    type: getImageMimeType(format),
  }));

  const fallback = getOptimizedPath(
    src,
    resolvedMetadata,
    resolvedMetadata.defaultFormat,
  );

  return { sources, fallback };
}
