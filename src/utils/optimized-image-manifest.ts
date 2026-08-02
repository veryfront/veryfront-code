import type {
  ImageVariant,
  OptimizedImageFormat,
  OptimizedImageManifestRenderSession,
  OptimizedImageManifestSnapshot,
  OptimizedImageMetadata,
} from "#veryfront/types";
import { IMAGE_OPTIMIZATION } from "./constants/build.ts";
import { MAX_PATH_LENGTH_CHARS } from "./constants/limits.ts";

export const MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER = 256;
export const MAX_OPTIMIZED_IMAGE_HYDRATION_BYTES = 512 * 1024;
export const OPTIMIZED_IMAGE_MANIFEST_IDENTITY_PATTERN = /^[0-9a-f]{64}$/;

const FORMATS = new Set<OptimizedImageFormat>([
  "webp",
  "avif",
  "jpeg",
  "png",
]);
const METADATA_PROPERTIES = new Set<PropertyKey>([
  "original",
  "originalSize",
  "variants",
  "defaultFormat",
  "aspectRatio",
  "engineIdentity",
  "quality",
]);
const VARIANT_PROPERTIES = new Set<PropertyKey>([
  "format",
  "size",
  "width",
  "height",
  "path",
  "fileSize",
  "quality",
]);
const SNAPSHOT_PROPERTIES = new Set<PropertyKey>(["identity", "entries"]);
const encoder = new TextEncoder();

function hasControlCharacters(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

function descriptors(value: object, label: string): PropertyDescriptorMap {
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch (cause) {
    throw new TypeError(`${label} could not be inspected`, { cause });
  }
}

function exactDataProperties(
  value: object,
  expected: ReadonlySet<PropertyKey>,
  label: string,
): PropertyDescriptorMap {
  const result = descriptors(value, label);
  const keys = Reflect.ownKeys(result);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key)) ||
    keys.some((key) => !("value" in result[key]!))
  ) {
    throw new TypeError(`${label} has an invalid property shape`);
  }
  return result;
}

function dataValue(
  source: PropertyDescriptorMap,
  key: string,
  label: string,
): unknown {
  const descriptor = source[key];
  if (!descriptor || !("value" in descriptor)) {
    throw new TypeError(`${label}.${key} must be a data property`);
  }
  return descriptor.value;
}

function positiveInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > maximum) {
    throw new TypeError(`${label} is outside its supported range`);
  }
  return value as number;
}

function imageFormat(value: unknown, label: string): OptimizedImageFormat {
  if (typeof value !== "string" || !FORMATS.has(value as OptimizedImageFormat)) {
    throw new TypeError(`${label} is not a supported image format`);
  }
  return value as OptimizedImageFormat;
}

/** Convert an image component source URL into its exact manifest key. */
export function normalizeOptimizedImageSourcePath(source: unknown): string {
  if (
    typeof source !== "string" ||
    source.length === 0 ||
    source.length > MAX_PATH_LENGTH_CHARS * 3 ||
    hasControlCharacters(source)
  ) {
    throw new TypeError("Optimized image source must be a bounded path");
  }
  const path = source.split(/[?#]/, 1)[0] ?? "";
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) || path.startsWith("//")) {
    throw new TypeError("Optimized image source must be a local path");
  }
  const encodedSegments = path.replace(/^\/+/, "").split("/");
  const decodedSegments = encodedSegments.map((segment) => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment).normalize("NFC");
    } catch (cause) {
      throw new TypeError("Optimized image source contains invalid encoding", {
        cause,
      });
    }
    if (decoded.includes("/") || decoded.includes("\\")) {
      throw new TypeError("Optimized image source contains an unsafe segment");
    }
    return decoded;
  });
  return canonicalOptimizedImageManifestPath(decodedSegments.join("/"));
}

/** Validate one unescaped, project-relative image-manifest path. */
export function canonicalOptimizedImageManifestPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    value !== value.normalize("NFC") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new TypeError("Optimized image manifest path is not canonical");
  }
  const result = value;
  if (result.length === 0 || result.length > MAX_PATH_LENGTH_CHARS) {
    throw new TypeError("Optimized image manifest path is outside its supported length");
  }
  return result;
}

function snapshotVariant(
  value: unknown,
  quality: number,
): ImageVariant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Optimized image variant must be an object");
  }
  const source = exactDataProperties(
    value,
    VARIANT_PROPERTIES,
    "Optimized image variant",
  );
  const format = imageFormat(
    dataValue(source, "format", "Optimized image variant"),
    "Optimized image variant format",
  );
  const size = positiveInteger(
    dataValue(source, "size", "Optimized image variant"),
    IMAGE_OPTIMIZATION.MAX_DIMENSION,
    "Optimized image variant size",
  );
  const width = positiveInteger(
    dataValue(source, "width", "Optimized image variant"),
    IMAGE_OPTIMIZATION.MAX_DIMENSION,
    "Optimized image variant width",
  );
  const height = positiveInteger(
    dataValue(source, "height", "Optimized image variant"),
    IMAGE_OPTIMIZATION.MAX_DIMENSION,
    "Optimized image variant height",
  );
  const path = canonicalOptimizedImageManifestPath(
    dataValue(source, "path", "Optimized image variant"),
  );
  const fileSize = positiveInteger(
    dataValue(source, "fileSize", "Optimized image variant"),
    Number.MAX_SAFE_INTEGER,
    "Optimized image variant fileSize",
  );
  const variantQuality = dataValue(source, "quality", "Optimized image variant");
  if (variantQuality !== quality || size !== width) {
    throw new TypeError("Optimized image variant does not match its metadata");
  }
  return Object.freeze({
    format,
    size,
    width,
    height,
    path,
    fileSize,
    quality,
  });
}

/** Validate and detach one manifest entry. */
export function snapshotOptimizedImageMetadata(
  value: unknown,
  expectedOriginal?: string,
): OptimizedImageMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Optimized image metadata must be an object");
  }
  const source = exactDataProperties(
    value,
    METADATA_PROPERTIES,
    "Optimized image metadata",
  );
  const original = canonicalOptimizedImageManifestPath(
    dataValue(source, "original", "Optimized image metadata"),
  );
  if (expectedOriginal !== undefined && original !== expectedOriginal) {
    throw new TypeError("Optimized image metadata does not match its manifest key");
  }
  const originalSize = positiveInteger(
    dataValue(source, "originalSize", "Optimized image metadata"),
    Number.MAX_SAFE_INTEGER,
    "Optimized image originalSize",
  );
  const defaultFormat = imageFormat(
    dataValue(source, "defaultFormat", "Optimized image metadata"),
    "Optimized image default format",
  );
  const aspectRatio = dataValue(source, "aspectRatio", "Optimized image metadata");
  if (typeof aspectRatio !== "number" || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new TypeError("Optimized image aspect ratio must be positive and finite");
  }
  const engineIdentity = dataValue(source, "engineIdentity", "Optimized image metadata");
  if (
    typeof engineIdentity !== "string" ||
    engineIdentity.length === 0 ||
    engineIdentity.length > IMAGE_OPTIMIZATION.MAX_ENGINE_IDENTITY_CHARACTERS ||
    engineIdentity.trim() !== engineIdentity ||
    engineIdentity.normalize("NFC") !== engineIdentity ||
    hasControlCharacters(engineIdentity)
  ) {
    throw new TypeError("Optimized image engine identity is invalid");
  }
  const quality = dataValue(source, "quality", "Optimized image metadata");
  if (!Number.isInteger(quality) || (quality as number) < 1 || (quality as number) > 100) {
    throw new TypeError("Optimized image quality must be an integer from 1 through 100");
  }
  const variantsValue = dataValue(source, "variants", "Optimized image metadata");
  if (
    !Array.isArray(variantsValue) ||
    variantsValue.length === 0 ||
    variantsValue.length > IMAGE_OPTIMIZATION.MAX_OUTPUT_SIZES * FORMATS.size
  ) {
    throw new TypeError("Optimized image variants are outside their supported count");
  }
  const variants = variantsValue.map((variant) => snapshotVariant(variant, quality as number));
  const identities = new Set<string>();
  const paths = new Set<string>();
  let hasDefault = false;
  for (const variant of variants) {
    const identity = `${variant.format}\0${variant.width}`;
    const path = variant.path.toLowerCase();
    if (identities.has(identity) || paths.has(path)) {
      throw new TypeError("Optimized image variants must be unique");
    }
    identities.add(identity);
    paths.add(path);
    if (variant.format === defaultFormat) hasDefault = true;
  }
  if (!hasDefault) {
    throw new TypeError("Optimized image metadata has no default-format variant");
  }
  return Object.freeze({
    original,
    originalSize,
    variants: Object.freeze(variants) as unknown as ImageVariant[],
    defaultFormat,
    aspectRatio,
    engineIdentity,
    quality: quality as number,
  });
}

/** Validate, detach, bound, and freeze a per-render manifest subset. */
export function snapshotOptimizedImageManifest(
  value: unknown,
  options: {
    maxEntries?: number;
    maxBytes?: number;
  } = {},
): OptimizedImageManifestSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Optimized image manifest snapshot must be an object");
  }
  const source = exactDataProperties(
    value,
    SNAPSHOT_PROPERTIES,
    "Optimized image manifest snapshot",
  );
  const identity = dataValue(source, "identity", "Optimized image manifest snapshot");
  if (
    typeof identity !== "string" ||
    !OPTIMIZED_IMAGE_MANIFEST_IDENTITY_PATTERN.test(identity)
  ) {
    throw new TypeError("Optimized image manifest identity must be a SHA-256 digest");
  }
  const entriesValue = dataValue(source, "entries", "Optimized image manifest snapshot");
  if (typeof entriesValue !== "object" || entriesValue === null || Array.isArray(entriesValue)) {
    throw new TypeError("Optimized image manifest entries must be an object");
  }
  const entryDescriptors = descriptors(entriesValue, "Optimized image manifest entries");
  const keys = Reflect.ownKeys(entryDescriptors);
  const maxEntries = options.maxEntries ?? MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER;
  if (
    keys.length > maxEntries ||
    keys.some((key) => typeof key !== "string") ||
    keys.some((key) => !("value" in entryDescriptors[key]!))
  ) {
    throw new TypeError(`Optimized image manifest exceeds ${maxEntries} entries`);
  }
  const entries = Object.create(null) as Record<string, OptimizedImageMetadata>;
  for (const key of (keys as string[]).sort()) {
    const canonicalKey = canonicalOptimizedImageManifestPath(key);
    if (canonicalKey !== key) {
      throw new TypeError("Optimized image manifest key is not canonical");
    }
    Object.defineProperty(entries, key, {
      configurable: false,
      enumerable: true,
      value: snapshotOptimizedImageMetadata(
        (entryDescriptors[key] as PropertyDescriptor & { value: unknown }).value,
        key,
      ),
      writable: false,
    });
  }
  Object.freeze(entries);
  const snapshot = Object.freeze({ identity, entries });
  const bytes = encoder.encode(JSON.stringify(snapshot)).byteLength;
  const maxBytes = options.maxBytes ?? MAX_OPTIMIZED_IMAGE_HYDRATION_BYTES;
  if (bytes > maxBytes) {
    throw new TypeError(`Optimized image manifest exceeds ${maxBytes} bytes`);
  }
  return snapshot;
}

function captureMethod(
  value: object,
  name: string,
  label: string,
): (...args: unknown[]) => unknown {
  let method: unknown;
  try {
    method = Reflect.get(value, name);
  } catch (cause) {
    throw new TypeError(`${label}.${name} could not be read`, { cause });
  }
  if (typeof method !== "function") {
    throw new TypeError(`${label}.${name} must be a function`);
  }
  return (...args: unknown[]) => Reflect.apply(method, value, args);
}

/**
 * Detach a request-scoped manifest session from a caller-owned object.
 *
 * The captured methods retain their original receiver so later replacement of
 * public properties cannot redirect lookups during an in-flight render.
 */
export function captureOptimizedImageManifestRenderSession(
  value: unknown,
): OptimizedImageManifestRenderSession {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Optimized image manifest render session must be an object");
  }
  let identity: unknown;
  try {
    identity = Reflect.get(value, "identity");
  } catch (cause) {
    throw new TypeError("Optimized image manifest render session identity could not be read", {
      cause,
    });
  }
  if (
    typeof identity !== "string" ||
    !OPTIMIZED_IMAGE_MANIFEST_IDENTITY_PATTERN.test(identity)
  ) {
    throw new TypeError("Optimized image manifest render session identity is invalid");
  }
  const resolve = captureMethod(
    value,
    "resolve",
    "Optimized image manifest render session",
  );
  const snapshotReferenced = captureMethod(
    value,
    "snapshotReferenced",
    "Optimized image manifest render session",
  );
  return Object.freeze({
    identity,
    resolve(source: string): OptimizedImageMetadata {
      return snapshotOptimizedImageMetadata(resolve(source));
    },
    snapshotReferenced(): OptimizedImageManifestSnapshot {
      return snapshotOptimizedImageManifest(snapshotReferenced());
    },
  });
}
