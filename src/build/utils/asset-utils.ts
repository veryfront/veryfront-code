/****
 * Consolidated asset utility functions for build pipeline
 * Merges CSS, Image, and Tailwind processor utilities
 */

import { basename, dirname, extname, join } from "#veryfront/compat/path/index.ts";
import { walk } from "#std/fs.ts";
import { logger } from "#veryfront/utils";
import type {
  ImageVariant,
  OptimizedImageMetadata,
} from "../asset-pipeline/image-optimizer/types.ts";
import { createError, toError } from "#veryfront/errors";
import {
  getOptimizedImageFormat,
  type ImageFormat,
  isImageFile as checkIsImage,
} from "./file-types.ts";

export const CSS_EXTENSIONS = [".css", ".scss", ".sass", ".less"];

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

export async function globFiles(pattern: string): Promise<string[]> {
  const [baseDirPart, filePatternPart] = pattern.split("**/");
  const baseDir = baseDirPart || ".";
  const filePattern = filePatternPart || pattern;

  const files: string[] = [];

  try {
    for await (
      const entry of walk(baseDir, {
        includeDirs: false,
        followSymlinks: false,
      })
    ) {
      if (!filePattern) {
        files.push(entry.path);
        continue;
      }

      const match = filePattern.replace("*", "");
      if (entry.name.includes(match)) files.push(entry.path);
    }
  } catch (error) {
    logger.warn(`Failed to glob files with pattern ${pattern}`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return files;
}

export function isPseudoSelector(selector: string): boolean {
  return selector.includes(":");
}

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

export function generateSrcSet(
  _imagePath: string,
  metadata: OptimizedImageMetadata,
  outputDir: string,
  format?: ImageFormat,
): string {
  const targetFormat = format ?? metadata.defaultFormat;
  const variants = metadata.variants
    .filter((variant) => variant.format === targetFormat)
    .sort((left, right) => left.width - right.width);
  const outputSegments = outputDir.replaceAll("\\", "/").split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  return variants.map((variant) => {
    const variantSegments = variant.path.replaceAll("\\", "/").split("/")
      .filter((segment) => segment.length > 0 && segment !== ".");
    const url = [...outputSegments, ...variantSegments]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    return `/${url} ${variant.width}w`;
  }).join(", ");
}

/**
 * @deprecated Missing dimensions return the historical square ratio. Build
 * code should use `calculateRequiredAspectRatio`.
 */
export function calculateAspectRatio(
  width: number | undefined,
  height: number | undefined,
): number {
  return width && height ? width / height : 1;
}

/**
 * Strict aspect-ratio calculation for build paths where dimensions are
 * required. Unlike the legacy `calculateAspectRatio` helper, this never
 * substitutes a square ratio for missing metadata.
 */
export function calculateRequiredAspectRatio(
  width: number,
  height: number,
): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new TypeError("Image dimensions must be positive finite numbers");
  }
  return width / height;
}

export const getOptimizedFormat = getOptimizedImageFormat;
export const isImageFile = checkIsImage;

/**
 * @deprecated Falls back to another available format for compatibility. Build
 * code should use `getRequiredImageDimensions`.
 */
export function getImageDimensions(metadata: OptimizedImageMetadata): {
  width: number;
  height: number;
} {
  const defaultVariant = findLargestVariant(
    metadata.variants.filter((variant) => variant.format === metadata.defaultFormat),
  );
  const selected = defaultVariant ?? findLargestVariant(metadata.variants);
  if (!selected) {
    throwMissingVariantError(metadata.defaultFormat);
  }
  return { width: selected.width, height: selected.height };
}

/**
 * Resolve dimensions only from the declared default output format.
 */
export function getRequiredImageDimensions(
  metadata: OptimizedImageMetadata,
): { width: number; height: number } {
  const selected = findLargestVariant(
    metadata.variants
      .filter((variant) => variant.format === metadata.defaultFormat),
  );

  if (!selected) {
    throwMissingVariantError(metadata.defaultFormat);
  }
  return { width: selected.width, height: selected.height };
}

function findLargestVariant(
  variants: ImageVariant[],
): ImageVariant | undefined {
  return variants.reduce<ImageVariant | undefined>(
    (largest, variant) => !largest || variant.width > largest.width ? variant : largest,
    undefined,
  );
}

function throwMissingVariantError(defaultFormat: string): never {
  throw toError(
    createError({
      type: "build",
      message: `No ${defaultFormat} image variants found in metadata`,
    }),
  );
}
