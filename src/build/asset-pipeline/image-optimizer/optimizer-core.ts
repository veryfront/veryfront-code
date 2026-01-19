import { relative } from "#veryfront/platform/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { DEFAULT_BUILD_CONCURRENCY } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { loadSharp } from "./sharp-loader.ts";
import { findImages } from "./image-finder.ts";
import { generateImageVariants } from "./variant-generator.ts";
import { writeManifest } from "./manifest-manager.ts";
import { calculateAspectRatio, generateSrcSet } from "../../utils/asset-utils.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  ImageFormat,
  ImageOptimizationOptions,
  ImageOptimizationStats,
  OptimizedImageMetadata,
  SharpConstructor,
} from "./types.ts";

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

export class ImageOptimizer {
  private options: Required<ImageOptimizationOptions>;
  private sharp: SharpConstructor | null = null;
  private imageManifest: Map<string, OptimizedImageMetadata> = new Map();
  private fs = createFileSystem();

  constructor(options: ImageOptimizationOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async init(): Promise<boolean> {
    if (!this.options.enabled) {
      logger.info("Image optimization is disabled");
      return false;
    }

    this.sharp = await loadSharp();
    return this.sharp !== null;
  }

  async optimize(): Promise<Map<string, OptimizedImageMetadata>> {
    const isReady = await this.init();
    if (!isReady) {
      return this.imageManifest;
    }

    logger.info("Starting image optimization", {
      inputDir: this.options.inputDir,
      outputDir: this.options.outputDir,
      formats: this.options.formats,
      sizes: this.options.sizes,
    });

    await this.fs.mkdir(this.options.outputDir, { recursive: true });

    const images = await findImages(this.options.inputDir);
    logger.info(`Found ${images.length} images to optimize`);

    const chunks = chunkArray(images, DEFAULT_BUILD_CONCURRENCY);

    for (const chunk of chunks) {
      await Promise.all(chunk.map((imagePath) => this.optimizeImage(imagePath)));
    }

    await writeManifest(this.imageManifest, this.options.outputDir);

    logger.info("Image optimization complete", {
      totalImages: this.imageManifest.size,
      totalVariants: this.getTotalVariants(),
    });

    return this.imageManifest;
  }

  private async optimizeImage(imagePath: string): Promise<void> {
    const relPath = relative(this.options.inputDir, imagePath);

    logger.debug(`Optimizing: ${relPath}`);

    try {
      if (!this.sharp) {
        throw toError(createError({
          type: "build",
          message: "Sharp not initialized - call init() first",
        }));
      }
      const imageBuffer = await this.fs.readFile(imagePath);
      const image = this.sharp(imageBuffer);
      const metadata = await image.metadata();

      const variants = await generateImageVariants(
        this.sharp,
        image,
        relPath,
        metadata,
        this.options.formats,
        this.options.sizes,
        this.options.quality,
        this.options.outputDir,
      );

      const defaultFormat = this.options.formats[0];
      if (!defaultFormat) {
        throw toError(createError({
          type: "build",
          message: `No image formats configured for optimization`,
        }));
      }

      this.imageManifest.set(relPath, {
        original: relPath,
        variants,
        defaultFormat,
        aspectRatio: calculateAspectRatio(metadata.width, metadata.height),
      });

      logger.debug(`Generated ${variants.length} variants for ${relPath}`);
    } catch (error) {
      logger.error(`Failed to optimize ${relPath}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  getImageMetadata(imagePath: string): OptimizedImageMetadata | null {
    return this.imageManifest.get(imagePath) ?? null;
  }

  generateSrcSet(imagePath: string, format?: ImageFormat): string {
    const metadata = this.imageManifest.get(imagePath);
    return metadata ? generateSrcSet(imagePath, metadata, this.options.outputDir, format) : "";
  }

  private getTotalVariants(): number {
    return Array.from(this.imageManifest.values()).reduce(
      (sum, metadata) => sum + metadata.variants.length,
      0,
    );
  }

  getStats(): ImageOptimizationStats {
    const totalImages = this.imageManifest.size;
    const totalVariants = this.getTotalVariants();

    const totalSize = Array.from(this.imageManifest.values()).reduce(
      (sum, metadata) =>
        sum + metadata.variants.reduce((variantSum, variant) => variantSum + variant.fileSize, 0),
      0,
    );

    return {
      totalImages,
      totalVariants,
      totalSize,
      averageSavings: totalVariants > 0 ? totalSize / totalVariants : 0,
    };
  }
}
