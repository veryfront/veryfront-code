import { isAbsolute, join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { MANIFEST_FILENAME } from "./constants.ts";
import type { OptimizedImageMetadata } from "./types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const IMAGE_FORMATS = new Set(["webp", "avif", "jpeg", "png"]);

function isSafeRelativePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || isAbsolute(path)) return false;
  const normalized = path.replaceAll("\\", "/");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.includes("\0")) return false;
  return !normalized.split("/").some((segment) => !segment || segment === "." || segment === "..");
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isOptimizedImageMetadata(value: unknown): value is OptimizedImageMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  if (!isSafeRelativePath(metadata.original)) return false;
  if (typeof metadata.defaultFormat !== "string" || !IMAGE_FORMATS.has(metadata.defaultFormat)) {
    return false;
  }
  if (
    !isFinitePositive(metadata.aspectRatio) || !Array.isArray(metadata.variants) ||
    metadata.variants.length === 0
  ) return false;
  if (metadata.originalSize !== undefined && !isPositiveInteger(metadata.originalSize)) {
    return false;
  }

  const variantKeys = new Set<string>();
  const variantPaths = new Set<string>();
  let hasDefaultFormat = false;
  for (const value of metadata.variants) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const variant = value as Record<string, unknown>;
    if (typeof variant.format !== "string" || !IMAGE_FORMATS.has(variant.format)) return false;
    if (!isPositiveInteger(variant.size) || !isPositiveInteger(variant.width)) return false;
    if (!isPositiveInteger(variant.height) || !isPositiveInteger(variant.fileSize)) return false;
    if (!isSafeRelativePath(variant.path)) return false;
    const key = `${variant.format}:${variant.size}`;
    if (variantKeys.has(key) || variantPaths.has(variant.path)) return false;
    variantKeys.add(key);
    variantPaths.add(variant.path);
    if (variant.format === metadata.defaultFormat) hasDefaultFormat = true;
  }

  return hasDefaultFormat;
}

function parseManifest(content: string): Map<string, OptimizedImageMetadata> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new TypeError("Invalid image manifest JSON", { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Invalid image manifest structure");
  }

  const entries = Object.entries(parsed);
  for (const [path, metadata] of entries) {
    if (
      !isSafeRelativePath(path) || !isOptimizedImageMetadata(metadata) ||
      metadata.original !== path
    ) {
      throw new TypeError(`Invalid image manifest entry: ${path}`);
    }
  }
  return new Map(entries as Array<[string, OptimizedImageMetadata]>);
}

export function writeManifest(
  imageManifest: Map<string, OptimizedImageMetadata>,
  outputDir: string,
): Promise<void> {
  return withSpan(
    "build.asset.writeManifest",
    async (): Promise<void> => {
      if (typeof outputDir !== "string" || !outputDir.trim()) {
        throw new TypeError("Image manifest outputDir must not be blank");
      }
      if (!(imageManifest instanceof Map)) throw new TypeError("Image manifest must be a Map");
      const fs = createFileSystem();
      const manifestPath = join(outputDir, MANIFEST_FILENAME);
      const serialized = JSON.stringify(Object.fromEntries(imageManifest), null, 2);
      parseManifest(serialized);

      const rename = fs.rename?.bind(fs);
      if (!rename) throw new TypeError("Atomic image manifest writes are not supported");
      const temporaryPath = `${manifestPath}.${crypto.randomUUID()}.tmp`;
      await fs.mkdir(outputDir, { recursive: true });
      try {
        await fs.writeTextFile(temporaryPath, serialized);
        await rename(temporaryPath, manifestPath);
      } catch (error) {
        try {
          await fs.remove(temporaryPath);
        } catch (cleanupError) {
          if (!isNotFoundError(cleanupError)) {
            throw new AggregateError(
              [error, cleanupError],
              "Image manifest write and temporary-file cleanup both failed",
            );
          }
        }
        throw error;
      }

      logger.debug("Wrote image manifest", { imageCount: imageManifest.size });
    },
    {
      "manifest.imageCount": imageManifest.size,
    },
  );
}

export function loadManifest(
  outputDir: string,
): Promise<Map<string, OptimizedImageMetadata>> {
  if (typeof outputDir !== "string" || !outputDir.trim()) {
    throw new TypeError("Image manifest outputDir must not be blank");
  }
  return withSpan(
    "build.asset.loadManifest",
    async (): Promise<Map<string, OptimizedImageMetadata>> => {
      const fs = createFileSystem();
      const manifestPath = join(outputDir, MANIFEST_FILENAME);

      try {
        const content = await fs.readTextFile(manifestPath);
        return parseManifest(content);
      } catch (error) {
        if (isNotFoundError(error)) return new Map();
        throw error;
      }
    },
    {},
  );
}
