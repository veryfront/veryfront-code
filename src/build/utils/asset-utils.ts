/**
 * Consolidated asset utility functions for build pipeline
 * Merges CSS, Image, and Tailwind processor utilities
 */

import { basename, dirname, extname, join } from "std/path/mod.ts";
import { walk } from "std/fs/mod.ts";
import { logger } from "@veryfront/utils";
import type { OptimizedImageMetadata } from "../asset-pipeline/image-optimizer/types.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import {
  getOptimizedImageFormat,
  type ImageFormat,
  isImageFile as checkIsImage,
} from "./file-types.ts";

// CSS-related utilities
export const CSS_EXTENSIONS = [".css", ".scss", ".sass", ".less"];

/**
 * Find all CSS files in a directory
 */
export async function findCSSFiles(dir: string): Promise<string[]> {
  const cssFiles: string[] = [];

  try {
    for await (
      const entry of walk(dir, {
        includeDirs: false,
        followSymlinks: false,
        exts: ["css"],
      })
    ) {
      cssFiles.push(entry.path);
    }
  } catch (error) {
    logger.warn(`Failed to read directory ${dir}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return cssFiles;
}

/**
 * Simple glob pattern matching for file discovery
 */
export async function globFiles(pattern: string): Promise<string[]> {
  // Extract directory and file pattern
  const parts = pattern.split("**/");
  const baseDir = parts[0] ? parts[0] : ".";
  const filePattern = parts[1] ? parts[1] : pattern;

  const files: string[] = [];

  try {
    for await (
      const entry of walk(baseDir, {
        includeDirs: false,
        followSymlinks: false,
      })
    ) {
      if (!filePattern || entry.name.includes(filePattern.replace("*", ""))) {
        files.push(entry.path);
      }
    }
  } catch (error) {
    logger.warn(`Failed to glob files with pattern ${pattern}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return files;
}

/**
 * Check if a selector is pseudo-class/pseudo-element
 */
export function isPseudoSelector(selector: string): boolean {
  return selector.includes(":");
}

/**
 * Get list of standard pseudo-selectors to preserve
 */
export function getStandardPseudoSelectors(): string[] {
  return [
    ":hover",
    ":focus",
    ":active",
    ":visited",
    ":disabled",
    ":checked",
    "::before",
    "::after",
    ":first-child",
    ":last-child",
    ":nth-child",
    ":focus-visible",
    ":focus-within",
  ];
}

// Image-related utilities

/**
 * Get variant path for optimized image
 */
export function getVariantPath(
  outputDir: string,
  relPath: string,
  format: ImageFormat,
  size: number,
): string {
  const dir = dirname(relPath);
  const name = basename(relPath, extname(relPath));
  return join(outputDir, dir, `${name}-${size}w.${format}`);
}

/**
 * Generate srcSet string for responsive images
 */
export function generateSrcSet(
  _imagePath: string,
  metadata: OptimizedImageMetadata,
  outputDir: string,
  format?: ImageFormat,
): string {
  const targetFormat = format || metadata.defaultFormat;
  const variants = metadata.variants.filter((v) => v.format === targetFormat);

  return variants
    .map((v) => `/${join(outputDir, v.path)} ${v.width}w`)
    .join(", ");
}

/**
 * Calculate aspect ratio from width and height
 */
export function calculateAspectRatio(
  width: number | undefined,
  height: number | undefined,
): number {
  return width && height ? width / height : 1;
}

/**
 * Re-export from centralized file-types module
 */
export const getOptimizedFormat = getOptimizedImageFormat;
export const isImageFile = checkIsImage;

/**
 * Get image dimensions from metadata
 */
export function getImageDimensions(metadata: OptimizedImageMetadata): {
  width: number;
  height: number;
} {
  const original = metadata.variants.find((v) => v.format === metadata.defaultFormat) ??
    metadata.variants[0];
  if (!original) {
    throw toError(createError({
      type: "build",
      message: "No image variants found in metadata",
    }));
  }
  return {
    width: original.width,
    height: original.height,
  };
}
