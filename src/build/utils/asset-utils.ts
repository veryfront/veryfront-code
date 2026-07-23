/****
 * Consolidated asset utility functions for build pipeline
 * Merges CSS, Image, and Tailwind processor utilities
 */

import { basename, dirname, extname, isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { globToRegExp } from "#std/path";
import { walk } from "#veryfront/compat/std/fs.ts";
import type {
  ImageVariant,
  OptimizedImageMetadata,
} from "../asset-pipeline/image-optimizer/types.ts";
import { createError, toError } from "#veryfront/errors";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import {
  getOptimizedImageFormat,
  type ImageFormat,
  isImageFile as checkIsImage,
} from "./file-types.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

export const CSS_EXTENSIONS = [".css", ".scss", ".sass", ".less"];
const IMAGE_FORMATS: ReadonlySet<string> = new Set([
  "jpeg",
  "jpg",
  "png",
  "webp",
  "avif",
  "gif",
  "svg",
]);

export async function findCSSFiles(dir: string): Promise<string[]> {
  if (!dir.trim()) throw new TypeError("CSS input directory must not be blank");
  const cssFiles: string[] = [];

  try {
    for await (
      const entry of walk(dir, {
        includeDirs: false,
        followSymlinks: false,
        exts: [".css"],
      })
    ) {
      cssFiles.push(entry.path);
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  return cssFiles.sort();
}

function normalizeGlobPath(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function getGlobBaseDir(pattern: string): string {
  const globIndex = pattern.search(/[?*[{]/);
  const staticPrefix = globIndex === -1 ? pattern : pattern.slice(0, globIndex);
  const lastSeparator = staticPrefix.lastIndexOf("/");
  if (lastSeparator === -1) return ".";
  if (lastSeparator === 0) return "/";
  return staticPrefix.slice(0, lastSeparator);
}

export function matchesGlob(path: string, pattern: string): boolean {
  if (!pattern.trim()) throw new TypeError("Glob pattern must not be blank");
  const normalizedPattern = normalizeGlobPath(pattern);
  const matcher = globToRegExp(normalizedPattern, { extended: true, globstar: true });
  return matcher.test(normalizeGlobPath(path));
}

export interface GlobFilesOptions {
  /** Maximum directory depth below the static glob prefix. */
  maxDepth?: number;
  /** Maximum number of filesystem entries inspected while matching. */
  maxScannedEntries?: number;
  /** Maximum number of matching files returned. */
  maxResults?: number;
}

function readGlobLimit(
  value: number | undefined,
  label: keyof GlobFilesOptions,
  minimum: number,
): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${label} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export async function globFiles(
  pattern: string,
  options: GlobFilesOptions = {},
): Promise<string[]> {
  if (!pattern.trim()) throw new TypeError("Glob pattern must not be blank");
  if (!options || typeof options !== "object") {
    throw new TypeError("Glob options must be an object");
  }
  const maxDepth = readGlobLimit(options.maxDepth, "maxDepth", 0);
  const maxScannedEntries = readGlobLimit(
    options.maxScannedEntries,
    "maxScannedEntries",
    1,
  );
  const maxResults = readGlobLimit(options.maxResults, "maxResults", 1);
  const normalizedPattern = normalizeGlobPath(pattern);
  const baseDir = getGlobBaseDir(normalizedPattern);
  const matcher = globToRegExp(normalizedPattern, { extended: true, globstar: true });

  const files: string[] = [];
  let scannedEntries = 0;

  try {
    for await (
      const entry of walk(baseDir, {
        includeDirs: true,
        followSymlinks: false,
        maxDepth,
      })
    ) {
      scannedEntries++;
      if (scannedEntries > maxScannedEntries) {
        throw new TypeError("Glob scan exceeds maxScannedEntries");
      }
      if (!entry.isFile || !matcher.test(normalizeGlobPath(entry.path))) continue;
      if (files.length >= maxResults) {
        throw new TypeError("Glob match count exceeds maxResults");
      }
      files.push(entry.path);
    }
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  return files.sort();
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
  if (!outputDir.trim()) throw new TypeError("outputDir must not be blank");
  if (!relPath || isAbsolute(relPath)) {
    throw new TypeError("Image path must be a safe relative path");
  }
  const normalizedRelPath = relPath.replaceAll("\\", "/");
  if (
    hasUnsafeControlCharacters(normalizedRelPath) ||
    normalizedRelPath.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new TypeError("Image path must be a safe relative path");
  }
  if (!IMAGE_FORMATS.has(format)) throw new TypeError("Unsupported image variant format");
  if (!Number.isInteger(size) || size <= 0) {
    throw new TypeError("Image variant width must be a positive integer");
  }

  const dir = dirname(relPath);
  const name = basename(relPath, extname(relPath));
  return join(outputDir, dir, `${name}-${size}w.${format}`);
}

function normalizePublicPath(publicPath: string): string {
  if (!publicPath.startsWith("/") || publicPath.includes("\\")) {
    throw new TypeError("publicPath must be an absolute URL path");
  }

  const normalized = publicPath.replace(/\/+$/, "");
  if (
    normalized.includes("?") || normalized.includes("#") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new TypeError("publicPath must be an absolute URL path without traversal or a query");
  }
  return normalized;
}

function encodeRelativeUrlPath(path: string): string {
  if (!path || isAbsolute(path)) throw new TypeError("Image variant path must be relative");
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) {
    throw new TypeError("Image variant path must be a safe relative path");
  }
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function generateSrcSet(
  imagePath: string,
  metadata: OptimizedImageMetadata,
  publicPath: string,
  format?: ImageFormat,
): string {
  if (!imagePath || metadata.original !== imagePath) {
    throw new TypeError("Image metadata does not match the requested image path");
  }
  const targetFormat = format ?? metadata.defaultFormat;
  if (!IMAGE_FORMATS.has(targetFormat)) throw new TypeError("Unsupported image variant format");
  const variants = metadata.variants
    .filter((variant) => variant.format === targetFormat)
    .sort((left, right) => left.width - right.width);
  if (variants.length === 0) {
    throw new TypeError("Image metadata has no variants for the requested format");
  }
  const widths = new Set<number>();
  for (const variant of variants) {
    if (!Number.isSafeInteger(variant.width) || variant.width <= 0 || widths.has(variant.width)) {
      throw new TypeError("Image variants must have unique positive integer widths");
    }
    widths.add(variant.width);
  }
  const basePath = normalizePublicPath(publicPath);

  return variants
    .map((variant) => `${basePath}/${encodeRelativeUrlPath(variant.path)} ${variant.width}w`)
    .join(", ");
}

export function calculateAspectRatio(
  width: number | undefined,
  height: number | undefined,
): number {
  if (
    typeof width !== "number" || typeof height !== "number" ||
    !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
  ) {
    throw new TypeError("Image dimensions must be positive finite numbers");
  }
  return width / height;
}

export const getOptimizedFormat = getOptimizedImageFormat;
export const isImageFile = checkIsImage;

export function getImageDimensions(metadata: OptimizedImageMetadata): {
  width: number;
  height: number;
} {
  const defaultVariants = metadata.variants.filter((v) => v.format === metadata.defaultFormat);
  const original = defaultVariants.reduce<ImageVariant | undefined>(
    (largest, variant) => !largest || variant.width > largest.width ? variant : largest,
    undefined,
  );

  if (!original) {
    throw toError(
      createError({
        type: "build",
        message: "No default-format image variants found in metadata",
      }),
    );
  }

  return { width: original.width, height: original.height };
}
