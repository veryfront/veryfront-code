import { IMAGE_OPTIMIZATION } from "#veryfront/utils";
import type { ImageOptimizationOptions } from "./types.ts";

export const DEFAULT_OPTIONS: Required<ImageOptimizationOptions> = {
  enabled: true,
  formats: ["webp", "avif", "jpeg"],
  sizes: [...IMAGE_OPTIMIZATION.DEFAULT_SIZES],
  quality: IMAGE_OPTIMIZATION.DEFAULT_QUALITY,
  inputDir: "./public",
  outputDir: "./.veryfront/optimized-images",
  publicPath: "/.veryfront/optimized-images",
  preserveOriginal: false,
};

export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

export const SHARP_MODULE_SPECIFIER = "npm:sharp@0.34.5";

export const MANIFEST_FILENAME = "image-manifest.json";
