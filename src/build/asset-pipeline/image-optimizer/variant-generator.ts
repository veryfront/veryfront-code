import { dirname, relative } from "std/path/mod.ts";
import { logger } from "@veryfront/utils";
import { createFileSystem } from "../../../platform/compat/fs.ts";
import { processFormat } from "./format-processor.ts";
import { calculateAspectRatio, getVariantPath } from "../../utils/asset-utils.ts";
import type {
  ImageFormat,
  ImageVariant,
  SharpConstructor,
  SharpInstance,
  SharpMetadata,
} from "./types.ts";

export async function generateVariant(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  format: ImageFormat,
  width: number,
  metadata: SharpMetadata,
  quality: number,
  outputDir: string,
): Promise<ImageVariant | null> {
  const fs = createFileSystem();
  try {
    const outputPath = getVariantPath(outputDir, relPath, format, width);
    await fs.mkdir(dirname(outputPath), { recursive: true });

    const processor = image.clone().resize(width, null, {
      fit: "inside",
      withoutEnlargement: true,
    });

    const formattedProcessor = processFormat(processor, format, quality);
    const buffer = await formattedProcessor.toBuffer();
    await fs.writeFile(outputPath, buffer);

    const processedMetadata = await sharp(buffer).metadata();

    return {
      format,
      size: width,
      width: processedMetadata.width || width,
      height: processedMetadata.height || Math.round(
        width / calculateAspectRatio(metadata.width, metadata.height),
      ),
      path: relative(outputDir, outputPath),
      fileSize: buffer.length,
    };
  } catch (error) {
    logger.error(`Failed to generate ${format} variant at ${width}px`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function generateImageVariants(
  sharp: SharpConstructor,
  image: SharpInstance,
  relPath: string,
  metadata: SharpMetadata,
  formats: ImageFormat[],
  sizes: number[],
  quality: number,
  outputDir: string,
): Promise<ImageVariant[]> {
  const variants: ImageVariant[] = [];

  for (const size of sizes) {
    if (metadata.width && metadata.width < size) {
      continue;
    }

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
      if (variant) {
        variants.push(variant);
      }
    }
  }

  for (const format of formats) {
    const variant = await generateVariant(
      sharp,
      image,
      relPath,
      format,
      metadata.width || 1920,
      metadata,
      quality,
      outputDir,
    );
    if (variant) {
      variants.push(variant);
    }
  }

  return variants;
}
