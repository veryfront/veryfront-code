import { IMAGE_OPTIMIZATION } from "../../../utils/index.js";
import type { ImageOptimizationOptions } from "./types.js";

export const DEFAULT_OPTIONS: Required<ImageOptimizationOptions> = {
  enabled: true,
  formats: ["webp", "avif", "jpeg"],
  sizes: [...IMAGE_OPTIMIZATION.DEFAULT_SIZES],
  quality: IMAGE_OPTIMIZATION.DEFAULT_QUALITY,
  inputDir: "./public",
  outputDir: "./.veryfront/optimized-images",
  preserveOriginal: false,
};

export const SUPPORTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];

export const SHARP_CDN_URL = "https://esm.sh/sharp@0.33.0";

export const MANIFEST_FILENAME = "image-manifest.json";
