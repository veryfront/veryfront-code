import { dirname, relative } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { processFormat } from "./format-processor.ts";
import { getVariantPath } from "../../utils/asset-utils.ts";
import type {
  ImageFormat,
  ImageVariant,
  SharpConstructor,
  SharpInstance,
  SharpMetadata,
} from "./types.ts";

const SUPPORTED_FORMATS = new Set<ImageFormat>(["webp", "avif", "jpeg", "png"]);
const MAX_VARIANT_WIDTH = 16_384;

function requireEncodedDimension(value: number | undefined): number {
  if (!Number.isInteger(value) || (value ?? 0) <= 0) {
    throw new TypeError("Encoded image dimensions are missing or invalid");
  }
  return value as number;
}

function generateVariant(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  format: ImageFormat,
  width: number,
  quality: number,
  outputDir: string,
): Promise<ImageVariant> {
  return withSpan(
    "build.asset.generateVariant",
    async (): Promise<ImageVariant> => {
      const fs = createFileSystem();
      const outputPath = getVariantPath(outputDir, relPath, format, width);

      const processor = image.clone().resize(width, null, {
        fit: "inside",
        withoutEnlargement: true,
      });

      const buffer = await processFormat(processor, format, quality).toBuffer();
      const processedMetadata = await sharp(buffer).metadata();
      const processedWidth = requireEncodedDimension(processedMetadata.width);
      const processedHeight = requireEncodedDimension(processedMetadata.height);

      await fs.mkdir(dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, buffer);

      return {
        format,
        size: width,
        width: processedWidth,
        height: processedHeight,
        path: relative(outputDir, outputPath).replaceAll("\\", "/"),
        fileSize: buffer.length,
      };
    },
    {
      "image.format": format,
      "image.width": width,
      "image.quality": quality,
    },
  );
}

export function generateImageVariants(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  metadata: SharpMetadata,
  formats: ImageFormat[],
  sizes: number[],
  quality: number,
  outputDir: string,
): Promise<ImageVariant[]> {
  return withSpan(
    "build.asset.generateImageVariants",
    async (): Promise<ImageVariant[]> => {
      const originalWidth = metadata.width;
      const originalHeight = metadata.height;
      if (
        typeof originalWidth !== "number" || typeof originalHeight !== "number" ||
        !Number.isFinite(originalWidth) || !Number.isFinite(originalHeight) ||
        originalWidth <= 0 || originalHeight <= 0
      ) {
        throw new TypeError("Image dimensions are missing or invalid");
      }
      if (formats.length === 0) throw new TypeError("At least one image format is required");
      const uniqueFormats = new Set<ImageFormat>();
      for (const format of formats) {
        if (!SUPPORTED_FORMATS.has(format)) {
          throw new TypeError(`Unsupported image format: ${String(format)}`);
        }
        if (uniqueFormats.has(format)) {
          throw new TypeError(`Image formats must not contain duplicate values: ${format}`);
        }
        uniqueFormats.add(format);
      }
      for (const size of sizes) {
        if (!Number.isInteger(size) || size < 1 || size > MAX_VARIANT_WIDTH) {
          throw new TypeError(
            `Image sizes must be integers between 1 and ${MAX_VARIANT_WIDTH}`,
          );
        }
      }
      if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
        throw new TypeError("Image quality must be an integer between 1 and 100");
      }

      const variants: ImageVariant[] = [];
      const allSizes = [
        ...new Set([...sizes.filter((size) => originalWidth >= size), originalWidth]),
      ]
        .sort((a, b) => a - b);

      for (const size of allSizes) {
        for (const format of formats) {
          const variant = await generateVariant(
            sharp,
            image,
            relPath,
            format,
            size,
            quality,
            outputDir,
          );

          variants.push(variant);
        }
      }

      return variants;
    },
    {
      "image.formats": formats.join(","),
      "image.sizesCount": sizes.length,
    },
  );
}
