import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "#veryfront/compat/path/index.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import type {
  ImageOptimizationEngine,
  ImageOptimizationResult,
} from "#veryfront/extensions/image/index.ts";
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
import {
  type BuildPublicationLock,
  createBuildPublication,
  nativeBuildPublicationLock,
} from "../../production-build/build/build-publication.ts";
import {
  calculateRequiredAspectRatio,
  generateSrcSet,
  getVariantPath,
  isContainedAssetPath,
} from "../../utils/asset-utils.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  DEFAULT_OPTIONS,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_INPUT_BYTES,
  MAX_IMAGE_OUTPUT_SIZES,
  MAX_IMAGE_PROVIDER_DURATION_MS,
  SUPPORTED_FORMATS,
} from "./constants.ts";
import { findImages } from "./image-finder.ts";
import { isSafeImageManifestPath, writeManifest } from "./manifest-manager.ts";
import {
  acquireConfiguredImageOptimization,
  createImageOptimizationSession,
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
  publicationLock?: BuildPublicationLock;
  engine?: ImageOptimizationEngine;
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

function snapshotDependencies(
  dependencies: ImageOptimizerDependencies,
): ImageOptimizerDependencies {
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    Array.isArray(dependencies)
  ) {
    throw new TypeError("Image optimizer dependencies must be an object");
  }
  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(dependencies);
  } catch (cause) {
    throw new TypeError("Image optimizer dependencies could not be inspected", {
      cause,
    });
  }
  for (const property of Reflect.ownKeys(descriptors)) {
    if (property !== "fs" && property !== "engine" && property !== "publicationLock") {
      throw new TypeError("Image optimizer dependencies contain unsupported properties");
    }
  }
  const read = (property: "fs" | "engine" | "publicationLock"): unknown => {
    const descriptor = descriptors[property];
    if (descriptor === undefined) return undefined;
    if (!Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`Image optimizer dependency ${property} must be a data property`);
    }
    return descriptor.value;
  };
  return Object.freeze({
    fs: read("fs") as FileSystem | undefined,
    engine: read("engine") as ImageOptimizationEngine | undefined,
    publicationLock: read("publicationLock") as BuildPublicationLock | undefined,
  });
}

export class ImageOptimizer {
  private options: Required<ImageOptimizationOptions>;
  private imageManifest = new Map<string, OptimizedImageMetadata>();
  private readonly fs: FileSystem;
  private readonly engine: ImageOptimizationEngine | undefined;
  private readonly publicationLock: BuildPublicationLock | undefined;
  private readonly outputUrlPath: string;

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
    const capturedDependencies = snapshotDependencies(dependencies);
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
    this.fs = capturedDependencies.fs ?? createFileSystem();
    this.engine = capturedDependencies.engine;
    this.publicationLock = capturedDependencies.publicationLock ??
      (capturedDependencies.fs === undefined ? nativeBuildPublicationLock : undefined);
    this.validateConfiguration();
    this.outputUrlPath = portablePath(
      relative(this.options.projectDir, this.options.outputDir),
    );
  }

  private validateConfiguration(): void {
    safeConfiguredPath(this.options.projectDir, "Image project directory");
    safeConfiguredPath(this.options.inputDir, "Image input directory");
    safeConfiguredPath(this.options.outputDir, "Image output directory");
    if (!isAbsolute(this.options.projectDir)) {
      throw new TypeError("Image project directory must be absolute");
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
    const inputDir = isAbsolute(this.options.inputDir)
      ? resolve(this.options.inputDir)
      : resolve(projectDir, this.options.inputDir);
    const outputDir = isAbsolute(this.options.outputDir)
      ? resolve(this.options.outputDir)
      : resolve(projectDir, this.options.outputDir);
    if (
      inputDir === projectDir ||
      outputDir === projectDir ||
      !isContainedAssetPath(projectDir, inputDir) ||
      !isContainedAssetPath(projectDir, outputDir)
    ) {
      throw new TypeError("Image input and output directories must be inside the project");
    }
    if (
      isContainedAssetPath(inputDir, outputDir) ||
      isContainedAssetPath(outputDir, inputDir)
    ) {
      throw new TypeError("Image input and output directories must not overlap");
    }

    this.options.projectDir = projectDir;
    this.options.inputDir = inputDir;
    this.options.outputDir = outputDir;
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

    const [canonicalProject, canonicalInput, canonicalOutput] = await Promise.all([
      realPath(this.options.projectDir),
      realPath(this.options.inputDir),
      canonicalTargetPath(this.options.outputDir),
    ]);
    if (
      !isContainedAssetPath(canonicalProject, canonicalInput) ||
      !isContainedAssetPath(canonicalProject, canonicalOutput)
    ) {
      throw new TypeError("Image input and output must remain inside the physical project");
    }
    if (
      isContainedAssetPath(canonicalInput, canonicalOutput) ||
      isContainedAssetPath(canonicalOutput, canonicalInput)
    ) {
      throw new TypeError("Physical image input and output directories must not overlap");
    }
  }

  /**
   * Validate that an enabled optimizer can capture its configured provider.
   * A publication captures a fresh immutable session in `optimize()` so a
   * prior readiness check never pins stale registry state.
   */
  init(): Promise<boolean> {
    return withSpan(
      "build.asset.ImageOptimizer.init",
      async () => {
        if (!this.options.enabled) {
          logger.info("Image optimization is disabled");
          return false;
        }
        this.createOperationSession();
        return true;
      },
      { "optimizer.enabled": this.options.enabled },
    );
  }

  private createOperationSession(): ImageOptimizationSession {
    return this.engine === undefined
      ? acquireConfiguredImageOptimization()
      : createImageOptimizationSession(this.engine);
  }

  optimize(): Promise<Map<string, OptimizedImageMetadata>> {
    return withSpan(
      "build.asset.ImageOptimizer.optimize",
      async () => {
        if (!this.options.enabled) return new Map();
        await this.validateFilesystemBoundaries();
        const optimizationSession = this.createOperationSession();

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
        const publication = await createBuildPublication(
          this.options.outputDir,
          false,
          { fs: this.fs, lock: this.publicationLock },
        );

        let failed = false;
        let failure: unknown;
        try {
          await this.fs.mkdir(publication.buildDir, { recursive: true });
          for (const chunk of chunkArray(images, DEFAULT_BUILD_CONCURRENCY)) {
            const settledEntries = await Promise.allSettled(
              chunk.map((imagePath) =>
                this.optimizeImage(
                  imagePath,
                  publication.buildDir,
                  outputOwners,
                  optimizationSession,
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

          await writeManifest(stagedManifest, publication.buildDir, this.fs);
          await publication.publish();
          this.imageManifest = cloneManifest(stagedManifest);
        } catch (error) {
          failed = true;
          failure = error;
        }

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
    optimizationSession: ImageOptimizationSession,
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
        const defaultFormat = this.options.formats[0]!;
        const lstat = this.fs.lstat?.bind(this.fs);
        if (!lstat) {
          throw INITIALIZATION_ERROR.create({
            detail: "Image optimization requires lstat support",
          });
        }
        const inputInfo = await lstat(imagePath);
        if (
          !inputInfo.isFile ||
          inputInfo.isSymlink ||
          !Number.isSafeInteger(inputInfo.size) ||
          inputInfo.size <= 0
        ) {
          throw new TypeError(`Image input must be a regular file: ${relativePath}`);
        }
        if (inputInfo.size > MAX_IMAGE_INPUT_BYTES) {
          throw new TypeError(
            `Image input exceeds ${MAX_IMAGE_INPUT_BYTES} bytes: ${relativePath}`,
          );
        }
        const imageBuffer = await this.fs.readFile(imagePath);
        if (imageBuffer.length === 0) {
          throw new TypeError(`Image input is empty: ${relativePath}`);
        }
        if (imageBuffer.length > MAX_IMAGE_INPUT_BYTES) {
          throw new TypeError(
            `Image input exceeds ${MAX_IMAGE_INPUT_BYTES} bytes: ${relativePath}`,
          );
        }

        const controller = new AbortController();
        const timeout = setTimeout(
          () => controller.abort(),
          MAX_IMAGE_PROVIDER_DURATION_MS,
        );
        let result: ImageOptimizationResult;
        try {
          result = await optimizationSession.run({
            input: imageBuffer,
            targetWidths: Object.freeze([...this.options.sizes]),
            formats: Object.freeze([...this.options.formats]),
            quality: this.options.quality,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const plannedVariants = result.variants.map((variant) => {
          const outputPath = getVariantPath(
            outputDir,
            relativePath,
            variant.format,
            variant.width,
          );
          const manifestPath = portablePath(relative(outputDir, outputPath))
            .normalize("NFC");
          if (!isSafeImageManifestPath(manifestPath)) {
            throw new TypeError(`Unsafe image variant path: ${manifestPath}`);
          }
          this.registerOutput(
            outputOwners,
            manifestPath,
            `${relativePath} ${variant.width}px ${variant.format}`,
          );
          return { variant, outputPath, manifestPath };
        });

        const variants: ImageVariant[] = [];
        for (const { variant, outputPath, manifestPath } of plannedVariants) {
          await this.fs.mkdir(dirname(outputPath), { recursive: true });
          await this.fs.writeFile(outputPath, variant.data);
          variants.push({
            format: variant.format,
            size: variant.width,
            width: variant.width,
            height: variant.height,
            path: manifestPath,
            fileSize: variant.data.length,
            quality: this.options.quality,
          });
        }
        if (this.options.preserveOriginal) {
          this.registerOutput(outputOwners, relativePath, `${relativePath} original`);
          const originalOutput = join(outputDir, relativePath);
          await this.fs.mkdir(dirname(originalOutput), { recursive: true });
          await this.fs.writeFile(originalOutput, imageBuffer);
        }

        return [
          relativePath,
          {
            original: relativePath,
            originalSize: imageBuffer.length,
            variants,
            defaultFormat,
            aspectRatio: calculateRequiredAspectRatio(
              result.sourceWidth,
              result.sourceHeight,
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
