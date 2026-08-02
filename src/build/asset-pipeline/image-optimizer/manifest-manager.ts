import { join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import {
  createFileSystem,
  type FileSystem,
  isNotFoundError,
} from "#veryfront/platform/compat/fs.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";
import {
  MANIFEST_FILENAME,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FILES,
  MAX_IMAGE_MANIFEST_BYTES,
  SUPPORTED_FORMATS,
} from "./constants.ts";
import type { ImageVariant, OptimizedImageMetadata } from "./types.ts";

const supportedFormats = new Set<string>(SUPPORTED_FORMATS);

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isSafeImageManifestPath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    value !== value.normalize("NFC") ||
    hasControlCharacters(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\")
  ) {
    return false;
  }

  return !value.split("/").some((segment) =>
    segment.length === 0 || segment === "." || segment === ".."
  );
}

export function writeManifest(
  imageManifest: Map<string, OptimizedImageMetadata>,
  outputDir: string,
  fs: FileSystem = createFileSystem(),
): Promise<void> {
  return withSpan(
    "build.asset.writeManifest",
    async (): Promise<void> => {
      const manifestPath = join(outputDir, MANIFEST_FILENAME);
      const sortedEntries = [...imageManifest].sort(([left], [right]) => comparePaths(left, right));
      assertManifestEntries(sortedEntries);
      const content = `${JSON.stringify(Object.fromEntries(sortedEntries), null, 2)}\n`;
      if (new TextEncoder().encode(content).length > MAX_IMAGE_MANIFEST_BYTES) {
        throw new TypeError(
          `Image manifest exceeds ${MAX_IMAGE_MANIFEST_BYTES} bytes`,
        );
      }

      await fs.writeTextFile(manifestPath, content);

      logger.debug(`Wrote image manifest to ${manifestPath}`);
    },
    {
      "manifest.outputDir": outputDir,
      "manifest.imageCount": imageManifest.size,
    },
  );
}

export function loadManifest(
  outputDir: string,
  fs: FileSystem = createFileSystem(),
): Promise<Map<string, OptimizedImageMetadata>> {
  return withSpan(
    "build.asset.loadManifest",
    async (): Promise<Map<string, OptimizedImageMetadata>> => {
      const manifestPath = join(outputDir, MANIFEST_FILENAME);

      let content: string;
      try {
        const fileInfo = fs.lstat ? await fs.lstat(manifestPath) : await fs.stat(manifestPath);
        if (!fileInfo.isFile || fileInfo.isSymlink) {
          throw new TypeError("Image manifest must be a regular file");
        }
        if (fileInfo.size > MAX_IMAGE_MANIFEST_BYTES) {
          throw new TypeError(
            `Image manifest exceeds ${MAX_IMAGE_MANIFEST_BYTES} bytes`,
          );
        }
        content = await fs.readTextFile(manifestPath);
      } catch (error) {
        if (isNotFoundError(error)) return new Map();
        throw error;
      }

      const parsed: unknown = JSON.parse(content);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new TypeError("Image manifest must be a JSON object");
      }

      const entries = Object.entries(parsed).map(
        ([key, value]): [string, unknown] => [
          key,
          normalizeLegacyDuplicateVariants(value),
        ],
      );
      assertManifestEntries(entries);
      return new Map(entries);
    },
    { "manifest.outputDir": outputDir },
  );
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isImageVariant(value: unknown): value is ImageVariant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const variant = value as Partial<ImageVariant>;
  return typeof variant.format === "string" &&
    supportedFormats.has(variant.format) &&
    isSafeImageManifestPath(variant.path) &&
    Number.isSafeInteger(variant.size) &&
    variant.size! > 0 &&
    variant.size! <= MAX_IMAGE_DIMENSION &&
    Number.isSafeInteger(variant.width) &&
    variant.width! > 0 &&
    variant.width! <= MAX_IMAGE_DIMENSION &&
    Number.isSafeInteger(variant.height) &&
    variant.height! > 0 &&
    variant.height! <= MAX_IMAGE_DIMENSION &&
    Number.isSafeInteger(variant.fileSize) &&
    variant.fileSize! > 0;
}

function variantFingerprint(variant: ImageVariant): string {
  return JSON.stringify([
    variant.format,
    variant.size,
    variant.width,
    variant.height,
    variant.path,
    variant.fileSize,
  ]);
}

/** Normalize only the exact duplicates emitted by the legacy size generator. */
function normalizeLegacyDuplicateVariants(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const metadata = value as Partial<OptimizedImageMetadata>;
  if (!Array.isArray(metadata.variants)) return value;

  const fingerprints = new Set<string>();
  const variants: ImageVariant[] = [];
  let removedDuplicate = false;
  for (const candidate of metadata.variants as unknown[]) {
    if (!isImageVariant(candidate)) return value;
    const fingerprint = variantFingerprint(candidate);
    if (fingerprints.has(fingerprint)) {
      removedDuplicate = true;
      continue;
    }
    fingerprints.add(fingerprint);
    variants.push(candidate);
  }

  return removedDuplicate ? { ...metadata, variants } : value;
}

function isOptimizedImageMetadata(
  value: unknown,
): value is OptimizedImageMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const metadata = value as Partial<OptimizedImageMetadata>;
  if (
    !isSafeImageManifestPath(metadata.original) ||
    (metadata.originalSize !== undefined &&
      (!Number.isSafeInteger(metadata.originalSize) ||
        metadata.originalSize <= 0)) ||
    !Array.isArray(metadata.variants) ||
    metadata.variants.length === 0 ||
    typeof metadata.defaultFormat !== "string" ||
    !supportedFormats.has(metadata.defaultFormat) ||
    !isPositiveFinite(metadata.aspectRatio)
  ) {
    return false;
  }

  const variantIdentities = new Set<string>();
  const variantPaths = new Set<string>();
  let hasDefaultFormat = false;
  for (const candidate of metadata.variants as unknown[]) {
    if (!isImageVariant(candidate)) return false;
    const variant = candidate;

    const identity = `${variant.format}\0${variant.size}`;
    const normalizedPath = variant.path.toLocaleLowerCase("en-US");
    if (
      variantIdentities.has(identity) ||
      variantPaths.has(normalizedPath)
    ) {
      return false;
    }
    variantIdentities.add(identity);
    variantPaths.add(normalizedPath);
    if (variant.format === metadata.defaultFormat) hasDefaultFormat = true;
  }
  return hasDefaultFormat;
}

function assertManifestEntry(
  key: string,
  value: unknown,
): asserts value is OptimizedImageMetadata {
  if (
    !isSafeImageManifestPath(key) ||
    !isOptimizedImageMetadata(value) ||
    value.original !== key
  ) {
    throw new TypeError(
      `Image manifest entry ${JSON.stringify(key)} is malformed`,
    );
  }
}

function assertManifestEntries(
  entries: Array<[string, unknown]>,
): asserts entries is Array<[string, OptimizedImageMetadata]> {
  if (entries.length > MAX_IMAGE_FILES) {
    throw new TypeError(`Image manifest exceeds ${MAX_IMAGE_FILES} entries`);
  }

  const normalizedKeys = new Set<string>();
  const normalizedVariantPaths = new Set<string>();
  for (const [key, value] of entries) {
    assertManifestEntry(key, value);
    const normalizedKey = key.toLocaleLowerCase("en-US");
    if (normalizedKeys.has(normalizedKey)) {
      throw new TypeError(
        `Image manifest contains a path collision: ${JSON.stringify(key)}`,
      );
    }
    normalizedKeys.add(normalizedKey);

    for (const variant of value.variants) {
      const normalizedPath = variant.path.toLocaleLowerCase("en-US");
      if (normalizedVariantPaths.has(normalizedPath)) {
        throw new TypeError(
          `Image manifest contains an output collision: ${JSON.stringify(variant.path)}`,
        );
      }
      normalizedVariantPaths.add(normalizedPath);
    }
  }
}
