import { relative } from "../../../platform/compat/path/index.js";
import { DEFAULT_BUILD_CONCURRENCY, logger } from "../../../utils/index.js";
import { createFileSystem } from "../../../platform/compat/fs.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { DEFAULT_OPTIONS } from "./constants.js";
import { loadSharp } from "./sharp-loader.js";
import { findImages } from "./image-finder.js";
import { generateImageVariants } from "./variant-generator.js";
import { writeManifest } from "./manifest-manager.js";
import { calculateAspectRatio, generateSrcSet } from "../../utils/asset-utils.js";
import { createError, toError } from "../../../errors/veryfront-error.js";
function chunkArray(items, chunkSize) {
    if (chunkSize <= 0)
        return [items];
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}
export class ImageOptimizer {
    options;
    sharp = null;
    imageManifest = new Map();
    fs = createFileSystem();
    constructor(options = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }
    init() {
        return withSpan("build.asset.ImageOptimizer.init", async () => {
            if (!this.options.enabled) {
                logger.info("Image optimization is disabled");
                return false;
            }
            this.sharp = await loadSharp();
            return this.sharp !== null;
        }, { "optimizer.enabled": this.options.enabled });
    }
    optimize() {
        return withSpan("build.asset.ImageOptimizer.optimize", async () => {
            const isReady = await this.init();
            if (!isReady)
                return this.imageManifest;
            logger.info("Starting image optimization", {
                inputDir: this.options.inputDir,
                outputDir: this.options.outputDir,
                formats: this.options.formats,
                sizes: this.options.sizes,
            });
            await this.fs.mkdir(this.options.outputDir, { recursive: true });
            const images = await findImages(this.options.inputDir);
            logger.info(`Found ${images.length} images to optimize`);
            for (const chunk of chunkArray(images, DEFAULT_BUILD_CONCURRENCY)) {
                await Promise.all(chunk.map((imagePath) => this.optimizeImage(imagePath)));
            }
            await writeManifest(this.imageManifest, this.options.outputDir);
            logger.info("Image optimization complete", {
                totalImages: this.imageManifest.size,
                totalVariants: this.getTotalVariants(),
            });
            return this.imageManifest;
        }, {
            "optimizer.inputDir": this.options.inputDir,
            "optimizer.outputDir": this.options.outputDir,
            "optimizer.formats": this.options.formats.join(","),
        });
    }
    optimizeImage(imagePath) {
        const relPath = relative(this.options.inputDir, imagePath);
        return withSpan("build.asset.ImageOptimizer.optimizeImage", async () => {
            logger.debug(`Optimizing: ${relPath}`);
            try {
                if (!this.sharp) {
                    throw toError(createError({
                        type: "build",
                        message: "Sharp not initialized - call init() first",
                    }));
                }
                const defaultFormat = this.options.formats[0];
                if (!defaultFormat) {
                    throw toError(createError({
                        type: "build",
                        message: "No image formats configured for optimization",
                    }));
                }
                const imageBuffer = await this.fs.readFile(imagePath);
                const image = this.sharp(imageBuffer);
                const metadata = await image.metadata();
                const variants = await generateImageVariants(this.sharp, image, relPath, metadata, this.options.formats, this.options.sizes, this.options.quality, this.options.outputDir);
                this.imageManifest.set(relPath, {
                    original: relPath,
                    variants,
                    defaultFormat,
                    aspectRatio: calculateAspectRatio(metadata.width, metadata.height),
                });
                logger.debug(`Generated ${variants.length} variants for ${relPath}`);
            }
            catch (error) {
                logger.error(`Failed to optimize ${relPath}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }, { "image.path": relPath });
    }
    getImageMetadata(imagePath) {
        return this.imageManifest.get(imagePath) ?? null;
    }
    generateSrcSet(imagePath, format) {
        const metadata = this.imageManifest.get(imagePath);
        if (!metadata)
            return "";
        return generateSrcSet(imagePath, metadata, this.options.outputDir, format);
    }
    getTotalVariants() {
        let total = 0;
        for (const metadata of this.imageManifest.values()) {
            total += metadata.variants.length;
        }
        return total;
    }
    getStats() {
        const totalImages = this.imageManifest.size;
        const totalVariants = this.getTotalVariants();
        let totalSize = 0;
        for (const metadata of this.imageManifest.values()) {
            for (const variant of metadata.variants) {
                totalSize += variant.fileSize;
            }
        }
        return {
            totalImages,
            totalVariants,
            totalSize,
            averageSavings: totalVariants > 0 ? totalSize / totalVariants : 0,
        };
    }
}
