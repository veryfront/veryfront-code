import { dirname, relative } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { processFormat } from "./format-processor.ts";
import { calculateAspectRatio, getVariantPath } from "../../utils/asset-utils.ts";
import type {
  ImageFormat,
  ImageVariant,
  SharpConstructor,
  SharpInstance,
  SharpMetadata,
} from "./types.ts";

/** Default assumed image width when metadata has no width */
const DEFAULT_IMAGE_WIDTH = 1_920;

function generateVariant(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  format: ImageFormat,
  width: number,
  metadata: SharpMetadata,
  quality: number,
  outputDir: string,
): Promise<ImageVariant | null> {
  return withSpan(
    "build.asset.generateVariant",
    async (): Promise<ImageVariant | null> => {
      const fs = createFileSystem();

      try {
        const outputPath = getVariantPath(outputDir, relPath, format, width);
        await fs.mkdir(dirname(outputPath), { recursive: true });

        const processor = image.clone().resize(width, null, {
          fit: "inside",
          withoutEnlargement: true,
        });

        const buffer = await processFormat(processor, format, quality).toBuffer();
        await fs.writeFile(outputPath, buffer);

        const processedMetadata = await sharp(buffer).metadata();
        const aspectRatio = calculateAspectRatio(metadata.width, metadata.height);

        return {
          format,
          size: width,
          width: processedMetadata.width ?? width,
          height: processedMetadata.height ?? Math.round(width / aspectRatio),
          path: relative(outputDir, outputPath),
          fileSize: buffer.length,
        };
      } catch (error) {
        logger.error(`Failed to generate ${format} variant at ${width}px`, {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
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
): Promise<ImageVariant[]> {
  return withSpan(
    "build.asset.generateImageVariants",
    async (): Promise<ImageVariant[]> => {
      const variants: ImageVariant[] = [];
      const originalWidth = metadata.width ?? DEFAULT_IMAGE_WIDTH;
      const metaWidth = metadata.width;

      const validSizes = metaWidth ? sizes.filter((size) => metaWidth >= size) : sizes;
      const allSizes = [...validSizes, originalWidth];

      for (const size of allSizes) {
        for (const format of formats) {
          const variant = await generateVariant(
            sharp,
            image,
            relPath,
            format,
            size,
            metadata,
            quality,
            outputDir,
          );

          if (variant) variants.push(variant);
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
