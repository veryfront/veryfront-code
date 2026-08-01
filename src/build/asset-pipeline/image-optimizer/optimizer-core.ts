import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type { ImageOptimizationVariantRequest } from "#veryfront/extensions/image/index.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
  realPath,
} from "#veryfront/platform/compat/fs.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { DEFAULT_BUILD_CONCURRENCY, logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { isContainedBuildPath } from "../../bundler/project-module-resolver.ts";
import {
  createBuildPublication,
  resolveBuildOutputOwnership,
} from "../../production-build/build/build-publication.ts";
import {
  calculateRequiredAspectRatio,
  generateSrcSet,
  getVariantPath,
} from "../../utils/asset-utils.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  DEFAULT_OPTIONS,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_SIZES,
  SUPPORTED_FORMATS,
} from "./constants.ts";
import { findImages } from "./image-finder.ts";
import { isSafeImageManifestPath, writeManifest } from "./manifest-manager.ts";
import {
  acquireConfiguredImageOptimization,
  type ImageOptimizationSession,
} from "./optimization-engine.ts";
import type {
  ImageFormat,
  ImageOptimizationOptions,
  ImageOptimizationStats,
  ImageVariant,
  OptimizedImageMetadata,
} from "./types.ts";

const supportedFormats = new Set<ImageFormat>(SUPPORTED_FORMATS);

export interface ImageOptimizerDependencies {
  fs?: FileSystem;
  /** Explicitly supplied session for composition tests and internal builds. */
  optimizationSession?: ImageOptimizationSession;
  /** Physical boundary for an output tree outside projectDir. */
  outputBoundary?: string;
  /** Explicit public URL root used by generateSrcSet(). */
  publicPath?: string;
  /** Cancels current and subsequent engine operations. */
  signal?: AbortSignal;
}

/** @internal — exported for testing */
export function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new TypeError("Image optimization chunk size must be a positive integer");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function safeConfiguredPath(path: string, label: string): void {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH_CHARS ||
    hasControlCharacters(path)
  ) {
    throw new TypeError(`${label} must be a safe non-empty path`);
  }
}

async function canonicalTargetPath(path: string): Promise<string> {
  const absolutePath = resolve(path);
  try {
    return await realPath(absolutePath);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  const suffix: string[] = [];
  let current = absolutePath;
  while (true) {
    const parent = dirname(current);
    if (parent === current) {
      throw new TypeError(`Cannot resolve image output path: ${path}`);
    }
    suffix.unshift(basename(current));
    try {
      return resolve(await realPath(parent), ...suffix);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      current = parent;
    }
  }
}

function portablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function safePublicPath(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    !value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    hasControlCharacters(value) ||
    value.split("/").some((segment, index) =>
      index > 0 && (segment === "" || segment.startsWith("."))
    )
  ) {
    throw new TypeError("Image publicPath must be a safe absolute URL path");
  }
}

function cloneMetadata(metadata: OptimizedImageMetadata): OptimizedImageMetadata {
  return {
    ...metadata,
    variants: metadata.variants.map((variant) => ({ ...variant })),
  };
}

function cloneManifest(
  manifest: Map<string, OptimizedImageMetadata>,
): Map<string, OptimizedImageMetadata> {
  return new Map(
    [...manifest].map(([path, metadata]) => [path, cloneMetadata(metadata)]),
  );
}

export class ImageOptimizer {
  private options: Required<ImageOptimizationOptions>;
  private optimizationSession: ImageOptimizationSession | null = null;
  private imageManifest = new Map<string, OptimizedImageMetadata>();
  private fs: FileSystem;
  private readonly configuredSession?: ImageOptimizationSession;
  private readonly signal?: AbortSignal;
  private outputBoundary: string;
  private outputUrlPath?: string;

  constructor(
    options: ImageOptimizationOptions = {},
    dependencies: ImageOptimizerDependencies = {},
  ) {
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
      throw new TypeError("Image optimization options must be an object");
    }
    if (options.formats !== undefined && !Array.isArray(options.formats)) {
      throw new TypeError("Image formats must be an array");
    }
    if (options.sizes !== undefined && !Array.isArray(options.sizes)) {
      throw new TypeError("Image sizes must be an array");
    }
    this.options = {
      enabled: options.enabled === undefined ? DEFAULT_OPTIONS.enabled : options.enabled,
      projectDir: options.projectDir === undefined ? cwd() : options.projectDir,
      formats: options.formats === undefined ? [...DEFAULT_OPTIONS.formats] : [...options.formats],
      sizes: options.sizes === undefined ? [...DEFAULT_OPTIONS.sizes] : [...options.sizes],
      quality: options.quality === undefined ? DEFAULT_OPTIONS.quality : options.quality,
      inputDir: options.inputDir === undefined ? DEFAULT_OPTIONS.inputDir : options.inputDir,
      outputDir: options.outputDir === undefined ? DEFAULT_OPTIONS.outputDir : options.outputDir,
      preserveOriginal: options.preserveOriginal === undefined
        ? DEFAULT_OPTIONS.preserveOriginal
        : options.preserveOriginal,
    };
    this.fs = dependencies.fs ?? createFileSystem();
    this.configuredSession = dependencies.optimizationSession;
    this.signal = dependencies.signal;
    this.outputBoundary = dependencies.outputBoundary ?? this.options.projectDir;
    this.validateConfiguration();
    if (dependencies.publicPath !== undefined) {
      safePublicPath(dependencies.publicPath);
      this.outputUrlPath = dependencies.publicPath;
    }
  }

  private validateConfiguration(): void {
    safeConfiguredPath(this.options.projectDir, "Image project directory");
    safeConfiguredPath(this.options.inputDir, "Image input directory");
    safeConfiguredPath(this.options.outputDir, "Image output directory");
    safeConfiguredPath(this.outputBoundary, "Image output boundary");
    if (!isAbsolute(this.options.projectDir)) {
      throw new TypeError("Image project directory must be absolute");
    }
    if (!isAbsolute(this.outputBoundary)) {
      throw new TypeError("Image output boundary must be absolute");
    }
    if (typeof this.options.enabled !== "boolean") {
      throw new TypeError("Image optimization enabled must be a boolean");
    }
    if (typeof this.options.preserveOriginal !== "boolean") {
      throw new TypeError("Image preserveOriginal must be a boolean");
    }
    if (
      !Number.isInteger(this.options.quality) ||
      this.options.quality < 1 ||
      this.options.quality > 100
    ) {
      throw new TypeError("Image quality must be an integer from 1 through 100");
    }
    if (
      this.options.formats.length === 0 ||
      new Set(this.options.formats).size !== this.options.formats.length ||
      this.options.formats.some((format) => !supportedFormats.has(format))
    ) {
      throw new TypeError("Image formats must be a non-empty, unique supported list");
    }
    if (
      this.options.sizes.length === 0 ||
      this.options.sizes.length > MAX_IMAGE_OUTPUT_SIZES ||
      new Set(this.options.sizes).size !== this.options.sizes.length ||
      this.options.sizes.some((size) =>
        !Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_DIMENSION
      )
    ) {
      throw new TypeError(
        `Image sizes must contain at most ${MAX_IMAGE_OUTPUT_SIZES} unique positive integers no larger than ${MAX_IMAGE_DIMENSION}`,
      );
    }

    const projectDir = resolve(this.options.projectDir);
    const outputBoundary = resolve(this.outputBoundary);
    const inputDir = isAbsolute(this.options.inputDir)
      ? resolve(this.options.inputDir)
      : resolve(projectDir, this.options.inputDir);
    const outputDir = isAbsolute(this.options.outputDir)
      ? resolve(this.options.outputDir)
      : resolve(projectDir, this.options.outputDir);
    if (
      inputDir === projectDir ||
      outputDir === outputBoundary ||
      !isContainedBuildPath(projectDir, inputDir) ||
      !isContainedBuildPath(outputBoundary, outputDir)
    ) {
      throw new TypeError(
        "Image input and output directories must remain inside their configured boundaries",
      );
    }
    if (
      isContainedBuildPath(inputDir, outputDir) ||
      isContainedBuildPath(outputDir, inputDir)
    ) {
      throw new TypeError("Image input and output directories must not overlap");
    }

    this.options.projectDir = projectDir;
    this.options.inputDir = inputDir;
    this.options.outputDir = outputDir;
    this.outputBoundary = outputBoundary;
  }

  private async validateFilesystemBoundaries(): Promise<void> {
    const lstat = this.fs.lstat?.bind(this.fs);
    if (!lstat) {
      throw INITIALIZATION_ERROR.create({
        detail: "Image optimization requires lstat support",
      });
    }

    const [projectInfo, inputInfo] = await Promise.all([
      lstat(this.options.projectDir),
      lstat(this.options.inputDir),
    ]);
    if (!projectInfo.isDirectory || projectInfo.isSymlink) {
      throw new TypeError("Image project directory must be a real directory");
    }
    if (!inputInfo.isDirectory || inputInfo.isSymlink) {
      throw new TypeError("Image input directory must be a real directory");
    }

    if (await this.fs.exists(this.options.outputDir)) {
      const outputInfo = await lstat(this.options.outputDir);
      if (!outputInfo.isDirectory || outputInfo.isSymlink) {
        throw new TypeError("Image output path must be a real directory");
      }
    }

    const [canonicalProject, canonicalInput, canonicalOutputBoundary, canonicalOutput] =
      await Promise.all([
        realPath(this.options.projectDir),
        realPath(this.options.inputDir),
        canonicalTargetPath(this.outputBoundary),
        canonicalTargetPath(this.options.outputDir),
      ]);
    if (
      !isContainedBuildPath(canonicalProject, canonicalInput) ||
      !isContainedBuildPath(canonicalOutputBoundary, canonicalOutput)
    ) {
      throw new TypeError(
        "Image input and output must remain inside their physical boundaries",
      );
    }
    if (
      isContainedBuildPath(canonicalInput, canonicalOutput) ||
      isContainedBuildPath(canonicalOutput, canonicalInput)
    ) {
      throw new TypeError("Physical image input and output directories must not overlap");
    }
  }

  init(): Promise<boolean> {
    return withSpan(
      "build.asset.ImageOptimizer.init",
      async () => {
        if (!this.options.enabled) {
          logger.info("Image optimization is disabled");
          return false;
        }
        if (!this.optimizationSession) {
          this.optimizationSession = this.configuredSession ??
            acquireConfiguredImageOptimization();
        }
        return true;
      },
      { "optimizer.enabled": this.options.enabled },
    );
  }

  optimize(): Promise<Map<string, OptimizedImageMetadata>> {
    return this.runOptimization(true);
  }

  /** Validate and encode every configured variant without publishing files. */
  preview(): Promise<Map<string, OptimizedImageMetadata>> {
    return this.runOptimization(false);
  }

  private runOptimization(
    publishOutputs: boolean,
  ): Promise<Map<string, OptimizedImageMetadata>> {
    return withSpan(
      publishOutputs ? "build.asset.ImageOptimizer.optimize" : "build.asset.ImageOptimizer.preview",
      async () => {
        if (!this.options.enabled) return new Map();
        await this.validateFilesystemBoundaries();
        await this.init();

        logger.info("Starting image optimization", {
          inputDir: this.options.inputDir,
          outputDir: this.options.outputDir,
          formats: this.options.formats,
          sizes: this.options.sizes,
        });

        const images = await findImages(this.options.inputDir, { fs: this.fs });
        if (images.length === 0) {
          throw new TypeError(
            `Image optimization found no supported images in ${this.options.inputDir}`,
          );
        }
        const stagedManifest = new Map<string, OptimizedImageMetadata>();
        const outputOwners = new Map<string, string>();
        const publication = publishOutputs
          ? await createBuildPublication(
            this.options.outputDir,
            false,
            { fs: this.fs },
          )
          : undefined;
        if (publication?.dryRun) {
          throw new TypeError("Image publication unexpectedly entered dry-run mode");
        }
        const generatedOutputDir = publication
          ? resolveBuildOutputOwnership(publication.outputOwnership, this.fs)
          : this.options.outputDir;

        let failed = false;
        let failure: unknown;
        try {
          for (const chunk of chunkArray(images, DEFAULT_BUILD_CONCURRENCY)) {
            const settledEntries = await Promise.allSettled(
              chunk.map((imagePath) =>
                this.optimizeImage(
                  imagePath,
                  generatedOutputDir,
                  outputOwners,
                  publishOutputs,
                )
              ),
            );
            const errors = settledEntries.flatMap((result) =>
              result.status === "rejected" ? [result.reason] : []
            );
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) {
              throw new AggregateError(
                errors,
                "Multiple images failed optimization",
              );
            }
            const entries = settledEntries.map((result) => {
              if (result.status !== "fulfilled") {
                throw new TypeError("Unreachable rejected image result");
              }
              return result.value;
            });
            for (const [relativePath, metadata] of entries) {
              stagedManifest.set(relativePath, metadata);
            }
          }

          if (publication) {
            await writeManifest(stagedManifest, generatedOutputDir, this.fs);
            await publication.publish();
          }
          this.imageManifest = cloneManifest(stagedManifest);
        } catch (error) {
          failed = true;
          failure = error;
        }

        if (publication) {
          try {
            await publication.cleanup();
          } catch (cleanupError) {
            if (failed) {
              throw new AggregateError(
                [failure, cleanupError],
                "Image optimization failed and staging cleanup also failed",
              );
            }
            throw cleanupError;
          }
        }
        if (failed) throw failure;

        logger.info("Image optimization complete", {
          totalImages: this.imageManifest.size,
          totalVariants: this.getTotalVariants(),
        });
        return cloneManifest(this.imageManifest);
      },
      {
        "optimizer.inputDir": this.options.inputDir,
        "optimizer.outputDir": this.options.outputDir,
        "optimizer.formats": this.options.formats.join(","),
      },
    );
  }

  private registerOutput(
    outputOwners: Map<string, string>,
    path: string,
    owner: string,
  ): void {
    const key = portablePath(path).normalize("NFC").toLocaleLowerCase("en-US");
    const previousOwner = outputOwners.get(key);
    if (previousOwner !== undefined) {
      throw new TypeError(
        `Image output collision between ${previousOwner} and ${owner}: ${path}`,
      );
    }
    outputOwners.set(key, owner);
  }

  private optimizeImage(
    imagePath: string,
    outputDir: string,
    outputOwners: Map<string, string>,
    writeOutputs: boolean,
  ): Promise<[string, OptimizedImageMetadata]> {
    const relativePath = portablePath(
      relative(this.options.inputDir, imagePath),
    ).normalize("NFC");
    if (!isSafeImageManifestPath(relativePath)) {
      throw new TypeError(`Unsafe image input path: ${relativePath}`);
    }

    return withSpan(
      "build.asset.ImageOptimizer.optimizeImage",
      async () => {
        const optimizationSession = this.optimizationSession;
        if (!optimizationSession) {
          throw INITIALIZATION_ERROR.create({
            detail: "Image optimization engine was not initialized",
          });
        }
        const defaultFormat = this.options.formats[0]!;
        const lstat = this.fs.lstat?.bind(this.fs);
        if (!lstat) {
          throw INITIALIZATION_ERROR.create({
            detail: "Image optimization requires lstat support",
          });
        }
        const inputInfo = await lstat(imagePath);
        if (!inputInfo.isFile || inputInfo.isSymlink) {
          throw new TypeError(`Image input must be a regular file: ${relativePath}`);
        }
        if (
          !Number.isSafeInteger(inputInfo.size) ||
          inputInfo.size <= 0 ||
          inputInfo.size > MAX_IMAGE_INPUT_BYTES
        ) {
          throw new TypeError(
            `Image input must contain at most ${MAX_IMAGE_INPUT_BYTES} bytes: ${relativePath}`,
          );
        }
        const imageBuffer = await this.fs.readFile(imagePath);
        if (imageBuffer.length !== inputInfo.size) {
          throw new TypeError(`Image input changed while being read: ${relativePath}`);
        }
        const requests: ImageOptimizationVariantRequest[] = [];
        const sizes = [...this.options.sizes].sort((left, right) => left - right);
        for (const size of sizes) {
          for (const format of this.options.formats) {
            requests.push(Object.freeze({
              format,
              width: size,
              quality: this.options.quality,
            }));
          }
        }
        const optimized = await optimizationSession.run(
          imageBuffer,
          Object.freeze(requests),
          this.signal,
        );

        const variants: ImageVariant[] = optimized.variants.map((variant) => {
          const outputPath = getVariantPath(
            outputDir,
            relativePath,
            variant.format,
            variant.width,
            this.options.quality,
          );
          return {
            format: variant.format,
            size: variant.width,
            width: variant.width,
            height: variant.height,
            path: portablePath(relative(outputDir, outputPath)),
            fileSize: variant.data.length,
            quality: this.options.quality,
          };
        });

        for (const variant of variants) {
          this.registerOutput(
            outputOwners,
            variant.path,
            `${relativePath} ${variant.width}px ${variant.format}`,
          );
        }
        if (writeOutputs) {
          for (let index = 0; index < variants.length; index++) {
            const variant = variants[index]!;
            const encoded = optimized.variants[index]!;
            const outputPath = join(outputDir, variant.path);
            const outputParent = dirname(outputPath);
            if (outputParent !== outputDir) {
              await this.fs.mkdir(outputParent, { recursive: true });
            }
            await this.fs.writeFile(outputPath, encoded.data);
          }
        }
        if (this.options.preserveOriginal) {
          this.registerOutput(outputOwners, relativePath, `${relativePath} original`);
          if (writeOutputs) {
            const originalOutput = join(outputDir, relativePath);
            const originalParent = dirname(originalOutput);
            if (originalParent !== outputDir) {
              await this.fs.mkdir(originalParent, { recursive: true });
            }
            await this.fs.writeFile(originalOutput, imageBuffer);
          }
        }

        return [
          relativePath,
          {
            original: relativePath,
            originalSize: imageBuffer.length,
            variants,
            defaultFormat,
            aspectRatio: calculateRequiredAspectRatio(
              optimized.sourceWidth,
              optimized.sourceHeight,
            ),
            engineIdentity: optimizationSession.cacheIdentity,
            quality: this.options.quality,
          },
        ];
      },
      { "image.path": relativePath },
    );
  }

  getImageMetadata(imagePath: string): OptimizedImageMetadata | null {
    const metadata = this.imageManifest.get(imagePath);
    return metadata ? cloneMetadata(metadata) : null;
  }

  generateSrcSet(imagePath: string, format?: ImageFormat): string {
    const metadata = this.imageManifest.get(imagePath);
    if (!metadata) return "";
    if (this.outputUrlPath === undefined) {
      throw new TypeError(
        "Image srcset generation requires an explicit publicPath",
      );
    }
    return generateSrcSet(imagePath, metadata, this.outputUrlPath, format);
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
    for (const { variants } of this.imageManifest.values()) {
      for (const { fileSize } of variants) totalSize += fileSize;
    }

    const averageVariantSize = totalVariants > 0 ? totalSize / totalVariants : 0;
    return {
      totalImages,
      totalVariants,
      totalSize,
      averageVariantSize,
      averageSavings: averageVariantSize,
    };
  }
}
