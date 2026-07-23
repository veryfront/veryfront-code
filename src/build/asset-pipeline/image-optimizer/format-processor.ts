import type { ImageFormat, SharpInstance } from "./types.ts";

export function processFormat(
  image: SharpInstance,
  format: ImageFormat,
  quality: number,
): SharpInstance {
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new TypeError("Image quality must be an integer between 1 and 100");
  }

  if (format === "webp") return image.webp({ quality });
  if (format === "avif") return image.avif({ quality });
  if (format === "jpeg") return image.jpeg({ quality, progressive: true });
  if (format === "png") {
    return image.png({ compressionLevel: 9, adaptiveFiltering: true });
  }

  throw new TypeError(`Unsupported image format: ${String(format)}`);
}
