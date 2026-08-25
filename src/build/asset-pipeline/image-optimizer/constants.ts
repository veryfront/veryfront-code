import { IMAGE_OPTIMIZATION } from "#veryfront/utils";
import { OPTIMIZABLE_IMAGE_SOURCE_EXTENSIONS } from "#veryfront/utils/image-variant-widths.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import type { ImageOptimizationOptions } from "./types.ts";

export const DEFAULT_OPTIONS: Required<ImageOptimizationOptions> = {
  enabled: true,
  projectDir: cwd(),
  formats: ["webp", "avif", "jpeg"],
  sizes: [...IMAGE_OPTIMIZATION.DEFAULT_SIZES],
  quality: IMAGE_OPTIMIZATION.DEFAULT_QUALITY,
  inputDir: "./public",
  outputDir: "./.veryfront/optimized-images",
  preserveOriginal: false,
};

export const SUPPORTED_EXTENSIONS = OPTIMIZABLE_IMAGE_SOURCE_EXTENSIONS.map((extension) =>
  `.${extension}`
);
export const SUPPORTED_FORMATS = ["webp", "avif", "jpeg", "png"] as const;

export const MANIFEST_FILENAME = "image-manifest.json";
export const MAX_IMAGE_DIMENSION = IMAGE_OPTIMIZATION.MAX_DIMENSION;
export const MAX_IMAGE_OUTPUT_SIZES = IMAGE_OPTIMIZATION.MAX_OUTPUT_SIZES;
export const MAX_IMAGE_FILES = 100_000;
export const MAX_IMAGE_MANIFEST_BYTES = 16 * 1024 * 1024;
export const MAX_IMAGE_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGE_DECODED_PIXELS = 100_000_000;
export const MAX_IMAGE_OUTPUT_BYTES_PER_VARIANT = 64 * 1024 * 1024;
export const MAX_IMAGE_TOTAL_OUTPUT_BYTES = 256 * 1024 * 1024;
export const MAX_IMAGE_PROVIDER_DURATION_MS = 120_000;
