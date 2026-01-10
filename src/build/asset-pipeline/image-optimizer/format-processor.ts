import type { ImageFormat, SharpInstance } from "./types.ts";

/**
 * Process an image into the specified format with quality settings
 */
export function processFormat(
  image: SharpInstance,
  format: ImageFormat,
  quality: number,
): SharpInstance {
  switch (format) {
    case "webp":
      return image.webp({ quality });
    case "avif":
      return image.avif({ quality });
    case "jpeg":
      return image.jpeg({ quality, progressive: true });
    case "png":
      return image.png({ compressionLevel: 9, adaptiveFiltering: true });
  }
}
