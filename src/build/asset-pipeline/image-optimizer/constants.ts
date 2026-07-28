import { IMAGE_OPTIMIZATION } from "#veryfront/utils";
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

export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];
export const SUPPORTED_FORMATS = ["webp", "avif", "jpeg", "png"] as const;

export const SHARP_MODULE_SPECIFIER = "npm:sharp@0.34.5";

export const MANIFEST_FILENAME = "image-manifest.json";
export const MAX_IMAGE_DIMENSION = IMAGE_OPTIMIZATION.MAX_DIMENSION;
export const MAX_IMAGE_OUTPUT_SIZES = IMAGE_OPTIMIZATION.MAX_OUTPUT_SIZES;
export const MAX_IMAGE_FILES = 100_000;
export const MAX_IMAGE_MANIFEST_BYTES = 16 * 1024 * 1024;
