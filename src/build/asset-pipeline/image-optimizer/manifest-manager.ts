import { join } from "#veryfront/compat/path/index.ts";
import { logger } from "#veryfront/utils";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import {
  MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "#veryfront/extensions/image/index.ts";
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
  MAX_IMAGE_OUTPUT_SIZES,
  SUPPORTED_FORMATS,
} from "./constants.ts";
import type { ImageVariant, OptimizedImageMetadata } from "./types.ts";

const supportedFormats = new Set<string>(SUPPORTED_FORMATS);
const metadataProperties = new Set<PropertyKey>([
  "original",
  "originalSize",
  "variants",
  "defaultFormat",
  "aspectRatio",
  "engineIdentity",
  "quality",
]);
const variantProperties = new Set<PropertyKey>([
  "format",
  "size",
  "width",
  "height",
  "path",
  "fileSize",
  "quality",
]);

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

      const entries = Object.entries(parsed);
      assertManifestEntries(entries);
      return new Map(entries);
    },
    { "manifest.outputDir": outputDir },
  );
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isQuality(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 100;
}

function isEngineIdentity(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IMAGE_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS &&
    value.trim() === value &&
    value.normalize("NFC") === value &&
    !hasControlCharacters(value);
}

function hasExactEnumerableDataProperties(
  value: object,
  expected: ReadonlySet<PropertyKey>,
): boolean {
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    return keys.length === expected.size &&
      keys.every((key) => expected.has(key)) &&
      keys.every((key) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
      });
  } catch {
    return false;
  }
}

function isImageVariant(value: unknown, quality: number): value is ImageVariant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (!hasExactEnumerableDataProperties(value, variantProperties)) return false;
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
    variant.size === variant.width &&
    Number.isSafeInteger(variant.height) &&
    variant.height! > 0 &&
    variant.height! <= MAX_IMAGE_DIMENSION &&
    Number.isSafeInteger(variant.fileSize) &&
    variant.fileSize! > 0 &&
    variant.quality === quality;
}

function isOptimizedImageMetadata(
  value: unknown,
): value is OptimizedImageMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (!hasExactEnumerableDataProperties(value, metadataProperties)) return false;
  const metadata = value as Partial<OptimizedImageMetadata>;
  if (
    !isSafeImageManifestPath(metadata.original) ||
    !Number.isSafeInteger(metadata.originalSize) ||
    metadata.originalSize! <= 0 ||
    !Array.isArray(metadata.variants) ||
    metadata.variants.length === 0 ||
    metadata.variants.length > MAX_IMAGE_OUTPUT_SIZES * supportedFormats.size ||
    typeof metadata.defaultFormat !== "string" ||
    !supportedFormats.has(metadata.defaultFormat) ||
    !isPositiveFinite(metadata.aspectRatio) ||
    !isEngineIdentity(metadata.engineIdentity) ||
    !isQuality(metadata.quality)
  ) {
    return false;
  }

  const variantIdentities = new Set<string>();
  const variantPaths = new Set<string>();
  let hasDefaultFormat = false;
  for (const candidate of metadata.variants as unknown[]) {
    if (!isImageVariant(candidate, metadata.quality)) return false;
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
