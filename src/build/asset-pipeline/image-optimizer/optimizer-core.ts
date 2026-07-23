import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { DEFAULT_BUILD_CONCURRENCY, logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { DEFAULT_OPTIONS } from "./constants.ts";
import { loadSharp } from "./sharp-loader.ts";
import { findImages } from "./image-finder.ts";
import { generateImageVariants } from "./variant-generator.ts";
import { writeManifest } from "./manifest-manager.ts";
import { calculateAspectRatio, generateSrcSet } from "../../utils/asset-utils.ts";
import { createError, toError } from "#veryfront/errors";
import type {
  ImageFormat,
  ImageOptimizationOptions,
  ImageOptimizationStats,
  OptimizedImageMetadata,
  SharpConstructor,
} from "./types.ts";

const SUPPORTED_FORMATS = new Set<ImageFormat>(["webp", "avif", "jpeg", "png"]);
const MAX_IMAGE_SIZES = 32;
const MAX_IMAGE_WIDTH = 16_384;

function isContainedRelativePath(path: string): boolean {
  return !isAbsolute(path) && path.split(/[\\/]/)[0] !== "..";
}

function normalizeOptions(options: ImageOptimizationOptions): Required<ImageOptimizationOptions> {
  const merged = { ...DEFAULT_OPTIONS, ...options };
  if (typeof merged.enabled !== "boolean") throw new TypeError("enabled must be a boolean");
  if (typeof merged.preserveOriginal !== "boolean") {
    throw new TypeError("preserveOriginal must be a boolean");
  }
  if (!Number.isInteger(merged.quality) || merged.quality < 1 || merged.quality > 100) {
    throw new TypeError("quality must be an integer between 1 and 100");
  }
  if (!Array.isArray(merged.formats) || merged.formats.length === 0) {
    throw new TypeError("formats must contain at least one image format");
  }
  for (const format of merged.formats) {
    if (!SUPPORTED_FORMATS.has(format)) throw new TypeError(`Unsupported image format: ${format}`);
  }
  if (
    !Array.isArray(merged.sizes) || merged.sizes.length === 0 ||
    merged.sizes.length > MAX_IMAGE_SIZES
  ) {
    throw new TypeError(`sizes must contain between 1 and ${MAX_IMAGE_SIZES} widths`);
  }
  for (const size of merged.sizes) {
    if (!Number.isInteger(size) || size < 1 || size > MAX_IMAGE_WIDTH) {
      throw new TypeError(`sizes must be integers between 1 and ${MAX_IMAGE_WIDTH}`);
    }
  }
  if (new Set(merged.formats).size !== merged.formats.length) {
    throw new TypeError("formats must not contain duplicates");
  }
  if (new Set(merged.sizes).size !== merged.sizes.length) {
    throw new TypeError("sizes must not contain duplicates");
  }
  if (!merged.inputDir.trim()) throw new TypeError("inputDir must not be blank");
  if (!merged.outputDir.trim()) throw new TypeError("outputDir must not be blank");
  if (
    !merged.publicPath.startsWith("/") || merged.publicPath.includes("\\") ||
    merged.publicPath.includes("?") || merged.publicPath.includes("#") ||
    merged.publicPath.split("/").some((segment) => segment === "..")
  ) {
    throw new TypeError("publicPath must be an absolute URL path without traversal or a query");
  }

  const inputDir = resolve(merged.inputDir);
  const outputDir = resolve(merged.outputDir);
  if (dirname(inputDir) === inputDir || dirname(outputDir) === outputDir) {
    throw new TypeError("inputDir and outputDir must not be filesystem roots");
  }
  const outputRelativePath = relative(inputDir, outputDir);
  const inputRelativePath = relative(outputDir, inputDir);
  if (
    outputRelativePath === "" ||
    isContainedRelativePath(outputRelativePath) ||
    isContainedRelativePath(inputRelativePath)
  ) {
    throw new TypeError("inputDir and outputDir must not contain each other");
  }

  return {
    ...merged,
    inputDir,
    outputDir,
    formats: [...new Set(merged.formats)],
    sizes: [...new Set(merged.sizes)].sort((a, b) => a - b),
  };
}

function cloneMetadata(metadata: OptimizedImageMetadata): OptimizedImageMetadata {
  return { ...metadata, variants: metadata.variants.map((variant) => ({ ...variant })) };
}

function cloneManifest(
  manifest: Map<string, OptimizedImageMetadata>,
): Map<string, OptimizedImageMetadata> {
  return new Map([...manifest].map(([path, metadata]) => [path, cloneMetadata(metadata)]));
}

/** @internal Exported for testing. */
export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new TypeError("chunkSize must be a positive integer");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function relativeImagePath(inputDir: string, imagePath: string): string {
  const relPath = relative(inputDir, imagePath).replaceAll("\\", "/");
  if (!relPath || isAbsolute(relPath) || relPath.split("/")[0] === "..") {
    throw new TypeError("Image path must stay inside inputDir");
  }
  return relPath;
}

function validateUniqueOutputStems(images: string[], inputDir: string): void {
  const stems = new Map<string, string>();
  for (const imagePath of images) {
    const relPath = relativeImagePath(inputDir, imagePath);
    const extension = extname(relPath);
    const stem = join(dirname(relPath), basename(relPath, extension)).replaceAll("\\", "/")
      .toLowerCase();
    const previous = stems.get(stem);
    if (previous) {
      throw new TypeError(
        `Image files must not share an output stem: ${previous} and ${relPath}`,
      );
    }
    stems.set(stem, relPath);
  }
}

export class ImageOptimizer {
  private options: Required<ImageOptimizationOptions>;
  private sharp: SharpConstructor | null = null;
  private imageManifest = new Map<string, OptimizedImageMetadata>();
  private fs = createFileSystem();
  private optimizationPromise: Promise<Map<string, OptimizedImageMetadata>> | null = null;
  private initializationPromise: Promise<boolean> | null = null;

  constructor(options: ImageOptimizationOptions = {}) {
    this.options = normalizeOptions(options);
  }

  init(): Promise<boolean> {
    if (this.initializationPromise) return this.initializationPromise;
    const promise = withSpan(
      "build.asset.ImageOptimizer.init",
      async () => {
        if (!this.options.enabled) {
          logger.info("Image optimization is disabled");
          return false;
        }

        if (!this.sharp) this.sharp = await loadSharp();
        return true;
      },
      { "optimizer.enabled": this.options.enabled },
    );
    this.initializationPromise = promise.catch((error) => {
      this.initializationPromise = null;
      throw error;
    });
    return this.initializationPromise;
  }

  optimize(): Promise<Map<string, OptimizedImageMetadata>> {
    if (this.optimizationPromise) {
      return this.optimizationPromise.then((manifest) => cloneManifest(manifest));
    }

    const optimizationPromise = withSpan(
      "build.asset.ImageOptimizer.optimize",
      async () => {
        const isReady = await this.init();
        if (!isReady) return cloneManifest(this.imageManifest);
        logger.info("Starting image optimization", {
          formats: this.options.formats,
          sizes: this.options.sizes,
        });

        const images = await findImages(this.options.inputDir);
        validateUniqueOutputStems(images, this.options.inputDir);
        logger.info(`Found ${images.length} images to optimize`);

        const stagingDir = join(
          dirname(this.options.outputDir),
          `.${basename(this.options.outputDir)}.${crypto.randomUUID()}.tmp`,
        );
        const nextManifest = new Map<string, OptimizedImageMetadata>();
        try {
          await this.fs.mkdir(dirname(this.options.outputDir), { recursive: true });
          await this.fs.mkdir(stagingDir, { recursive: false });
          for (const chunk of chunkArray(images, DEFAULT_BUILD_CONCURRENCY)) {
            const entries = await Promise.all(
              chunk.map((imagePath) => this.optimizeImage(imagePath, stagingDir)),
            );
            for (const [relPath, metadata] of entries) nextManifest.set(relPath, metadata);
          }

          await writeManifest(nextManifest, stagingDir);
          await this.commitStagingDirectory(stagingDir);
        } catch (error) {
          try {
            if (await this.fs.exists(stagingDir)) {
              await this.fs.remove(stagingDir, { recursive: true });
            }
          } catch (cleanupError) {
            throw new AggregateError(
              [error, cleanupError],
              "Image optimization and staging cleanup both failed",
            );
          }
          throw error;
        }

        this.imageManifest = nextManifest;
        logger.info("Image optimization complete", {
          totalImages: nextManifest.size,
          totalVariants: this.getTotalVariants(),
        });

        return cloneManifest(nextManifest);
      },
      {
        "optimizer.formats": this.options.formats.join(","),
      },
    );
    this.optimizationPromise = optimizationPromise;
    return optimizationPromise.finally(() => {
      this.optimizationPromise = null;
    });
  }

  private optimizeImage(
    imagePath: string,
    outputDir: string,
  ): Promise<[string, OptimizedImageMetadata]> {
    const relPath = relativeImagePath(this.options.inputDir, imagePath);

    return withSpan(
      "build.asset.ImageOptimizer.optimizeImage",
      async (): Promise<[string, OptimizedImageMetadata]> => {
        logger.debug(`Optimizing: ${relPath}`);

        const sharp = this.sharp;
        if (!sharp) {
          throw toError(
            createError({
              type: "build",
              message: "Sharp not initialized - call init() first",
            }),
          );
        }

        const defaultFormat = this.options.formats[0];
        if (!defaultFormat) {
          throw toError(
            createError({
              type: "build",
              message: "No image formats configured for optimization",
            }),
          );
        }

        const imageBuffer = await this.fs.readFile(imagePath);
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();

        const variants = await generateImageVariants(
          sharp,
          image,
          relPath,
          metadata,
          this.options.formats,
          this.options.sizes,
          this.options.quality,
          outputDir,
        );

        if (this.options.preserveOriginal) {
          const originalOutputPath = join(outputDir, relPath);
          await this.fs.mkdir(dirname(originalOutputPath), { recursive: true });
          await this.fs.writeFile(originalOutputPath, imageBuffer);
        }

        const optimizedMetadata: OptimizedImageMetadata = {
          original: relPath.replaceAll("\\", "/"),
          originalSize: imageBuffer.length,
          variants,
          defaultFormat,
          aspectRatio: calculateAspectRatio(metadata.width, metadata.height),
        };

        logger.debug("Generated image variants", { count: variants.length });
        return [relPath, optimizedMetadata];
      },
      {},
    );
  }

  private async commitStagingDirectory(stagingDir: string): Promise<void> {
    if (!this.fs.rename) throw new TypeError("Atomic image output commits are not supported");
    const outputDir = this.options.outputDir;
    const backupDir = join(
      dirname(outputDir),
      `.${basename(outputDir)}.${crypto.randomUUID()}.backup`,
    );
    const hadOutput = await this.fs.exists(outputDir);
    if (hadOutput) {
      const outputInfo = this.fs.lstat
        ? await this.fs.lstat(outputDir)
        : await this.fs.stat(outputDir);
      if (!outputInfo.isDirectory || outputInfo.isSymlink) {
        throw new TypeError("Image outputDir must be a real directory when it already exists");
      }
      await this.fs.rename(outputDir, backupDir);
    }

    try {
      await this.fs.rename(stagingDir, outputDir);
    } catch (commitError) {
      if (hadOutput && await this.fs.exists(backupDir)) {
        try {
          await this.fs.rename(backupDir, outputDir);
        } catch (restoreError) {
          throw new AggregateError(
            [commitError, restoreError],
            "Image output commit and previous-output restoration both failed",
          );
        }
      }
      throw commitError;
    }

    if (!hadOutput) return;
    try {
      await this.fs.remove(backupDir, { recursive: true });
    } catch (cleanupError) {
      const rollbackErrors: unknown[] = [];
      try {
        await this.fs.remove(outputDir, { recursive: true });
      } catch (error) {
        rollbackErrors.push(error);
      }
      try {
        await this.fs.rename(backupDir, outputDir);
      } catch (error) {
        rollbackErrors.push(error);
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [cleanupError, ...rollbackErrors],
          "Image output cleanup and rollback failed",
        );
      }
      throw cleanupError;
    }
  }

  getImageMetadata(imagePath: string): OptimizedImageMetadata | null {
    const metadata = this.imageManifest.get(imagePath);
    return metadata ? cloneMetadata(metadata) : null;
  }

  generateSrcSet(imagePath: string, format?: ImageFormat): string {
    const metadata = this.imageManifest.get(imagePath);
    if (!metadata) throw new TypeError("Image metadata was not found for the requested path");
    return generateSrcSet(imagePath, metadata, this.options.publicPath, format);
  }

  private getTotalVariants(): number {
    let total = 0;
    for (const { variants } of this.imageManifest.values()) {
      total += variants.length;
    }
    return total;
  }

  getStats(): ImageOptimizationStats {
    const totalImages = this.imageManifest.size;
    const totalVariants = this.getTotalVariants();

    let totalSize = 0;
    let savingsTotal = 0;
    let imagesWithSourceSize = 0;
    for (const { originalSize, variants } of this.imageManifest.values()) {
      let imageSavingsTotal = 0;
      for (const { fileSize } of variants) {
        totalSize += fileSize;
        if (originalSize && originalSize > 0) {
          imageSavingsTotal += ((originalSize - fileSize) / originalSize) * 100;
        }
      }
      if (originalSize && originalSize > 0 && variants.length > 0) {
        savingsTotal += imageSavingsTotal / variants.length;
        imagesWithSourceSize++;
      }
    }

    return {
      totalImages,
      totalVariants,
      totalSize,
      averageSavings: imagesWithSourceSize > 0 ? savingsTotal / imagesWithSourceSize : 0,
    };
  }
}
