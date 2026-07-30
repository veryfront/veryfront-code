/**
 * Components - Optimized Image
 *
 * @module react/components/optimized-image
 */

export { OptimizedBackgroundImage } from "./OptimizedBackgroundImage.tsx";
export { OptimizedImage } from "./OptimizedImage.tsx";
export type { OptimizedImageProps } from "./OptimizedImage.tsx";
export { SimpleOptimizedImage } from "./SimpleOptimizedImage.tsx";
export { useOptimizedImage } from "./useOptimizedImage.ts";
export { ImageManifestProvider, useOptimizedImageMetadata } from "../../runtime/core.ts";
export type { ImageManifestProviderProps } from "../../runtime/core.ts";
export { generateBlurDataURL, getAspectRatioPadding, ResponsiveImageContainer } from "./utils.tsx";
