import type { ImageFormat, SharpInstance } from "./types.ts";

export function processFormat(
  image: SharpInstance,
  format: ImageFormat,
  quality: number,
): SharpInstance {
  if (format === "webp") return image.webp({ quality });
  if (format === "avif") return image.avif({ quality });
  if (format === "jpeg") return image.jpeg({ quality, progressive: true });
  if (format === "png") {
    return image.png({ compressionLevel: 9, adaptiveFiltering: true });
  }

  return image;
}
