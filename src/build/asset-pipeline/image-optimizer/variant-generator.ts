import { dirname, relative } from "#veryfront/compat/path/index.ts";
import { createFileSystem, type FileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { processFormat } from "./format-processor.ts";
import { getVariantPath } from "../../utils/asset-utils.ts";
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_OUTPUT_SIZES, SUPPORTED_FORMATS } from "./constants.ts";
import type {
  ImageFormat,
  ImageVariant,
  SharpConstructor,
  SharpInstance,
  SharpMetadata,
} from "./types.ts";

function generateVariant(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  format: ImageFormat,
  width: number,
  quality: number,
  outputDir: string,
  fs: FileSystem,
): Promise<ImageVariant> {
  return withSpan(
    "build.asset.generateVariant",
    async (): Promise<ImageVariant> => {
      const outputPath = getVariantPath(outputDir, relPath, format, width);
      await fs.mkdir(dirname(outputPath), { recursive: true });

      const processor = image.clone().resize(width, null, {
        fit: "inside",
        withoutEnlargement: true,
      });

      const buffer = await processFormat(processor, format, quality).toBuffer();
      if (buffer.length === 0) {
        throw new TypeError(
          `Image encoder returned an empty ${format} variant at ${width}px`,
        );
      }

      const processedMetadata = await sharp(buffer).metadata();
      const processedWidth = processedMetadata.width;
      const processedHeight = processedMetadata.height;
      if (
        !isValidDimension(processedWidth) ||
        !isValidDimension(processedHeight)
      ) {
        throw new TypeError(
          `Encoded ${format} variant has invalid dimensions at ${width}px`,
        );
      }
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
      "image.path": relPath,
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
  fs: FileSystem = createFileSystem(),
): Promise<ImageVariant[]> {
  return withSpan(
    "build.asset.generateImageVariants",
    async (): Promise<ImageVariant[]> => {
      const originalWidth = metadata.width;
      const originalHeight = metadata.height;
      if (
        !isValidDimension(originalWidth) ||
        !isValidDimension(originalHeight)
      ) {
        throw new TypeError(
          `Image metadata requires positive integer dimensions no larger than ${MAX_IMAGE_DIMENSION}: ${relPath}`,
        );
      }
      if (
        formats.length === 0 ||
        new Set(formats).size !== formats.length ||
        formats.some((format) => !SUPPORTED_FORMATS.includes(format))
      ) {
        throw new TypeError(
          "Image output formats must be a non-empty, unique supported list",
        );
      }
      if (
        sizes.length > MAX_IMAGE_OUTPUT_SIZES ||
        new Set(sizes).size !== sizes.length ||
        sizes.some((size) => !Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_DIMENSION)
      ) {
        throw new TypeError(
          `Image output sizes must contain at most ${MAX_IMAGE_OUTPUT_SIZES} unique positive integers no larger than ${MAX_IMAGE_DIMENSION}`,
        );
      }

      const variants: ImageVariant[] = [];
      const allSizes = [
        ...new Set([
          ...sizes.filter((size) => originalWidth >= size),
          originalWidth,
        ]),
      ].sort((left, right) => left - right);

      for (const size of allSizes) {
        for (const format of formats) {
          variants.push(
            await generateVariant(
              sharp,
              image,
              relPath,
              format,
              size,
              quality,
              outputDir,
              fs,
            ),
          );
        }
      }

      return variants;
    },
    {
      "image.path": relPath,
      "image.formats": formats.join(","),
      "image.sizesCount": sizes.length,
    },
  );
}

function isValidDimension(value: unknown): value is number {
  return Number.isInteger(value) &&
    (value as number) > 0 &&
    (value as number) <= MAX_IMAGE_DIMENSION;
}
