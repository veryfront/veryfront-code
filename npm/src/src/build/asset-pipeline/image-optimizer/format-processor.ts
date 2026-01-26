import type { ImageFormat, SharpInstance } from "./types.js";

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
    default:
      return image;
  }
}
