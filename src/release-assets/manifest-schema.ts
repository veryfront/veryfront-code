/**
 * Release Asset Manifest — v1 body schema, types, and validator.
 *
 * The manifest body is content-addressed metadata describing transformed
 * browser modules and compiled CSS for a release, plus the per-route closure
 * used to drive preload hints and asset URL rewriting.
 *
 * The extension-backed schema is used when the schema contract is available.
 * Consumption paths also use a dependency-free parser that applies the same
 * bounds and returns a detached, deeply frozen snapshot.
 *
 * @module release-assets/manifest-schema
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "veryfront/extensions/schema";
import {
  isValidContentHash,
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  type ReleaseAssetContentType,
} from "./constants.ts";
import { hasControlCharacters } from "./string-validation.ts";

const {
  identifierLength: MAX_IDENTIFIER_LENGTH,
  builderVersionLength: MAX_BUILDER_VERSION_LENGTH,
  manifestKeyLength: MAX_MANIFEST_KEY_LENGTH,
  styleProfileHashLength: MAX_STYLE_PROFILE_HASH_LENGTH,
  gapLength: MAX_GAP_LENGTH,
  moduleEntries: MAX_MODULE_ENTRIES,
  dependencyEntries: MAX_DEPENDENCY_ENTRIES,
  cssEntries: MAX_CSS_ENTRIES,
  routeEntries: MAX_ROUTE_ENTRIES,
  routeModules: MAX_ROUTE_MODULES,
  routeCssEntries: MAX_ROUTE_CSS_ENTRIES,
  fallbackGaps: MAX_FALLBACK_GAPS,
  totalRouteReferences: MAX_TOTAL_ROUTE_REFERENCES,
} = RELEASE_ASSET_MANIFEST_LIMITS;
const MODULE_EXTENSION_PATTERN = /\.(?:tsx?|jsx?|mdx)$/;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const MANIFEST_KEYS = new Set([
  "schemaVersion",
  "projectId",
  "releaseId",
  "releaseVersion",
  "manifestVersion",
  "builderVersion",
  "sourceContentHash",
  "createdAt",
  "assetBasePath",
  "modules",
  "css",
  "routes",
  "dependencies",
  "fallback",
]);
const ASSET_ENTRY_KEYS = new Set(["contentHash", "size", "contentType"]);
const CSS_ENTRY_KEYS = new Set([
  "contentHash",
  "size",
  "contentType",
  "styleProfileHash",
]);
const ROUTE_ENTRY_KEYS = new Set(["modules", "css"]);
const FALLBACK_KEYS = new Set(["mode", "gaps"]);

function isSafeBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !hasControlCharacters(value);
}

function isCanonicalModuleKey(value: string): boolean {
  if (
    !isSafeBoundedText(value, MAX_MANIFEST_KEY_LENGTH) ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    !MODULE_EXTENSION_PATTERN.test(value)
  ) {
    return false;
  }

  const parts = value.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isSafeDependencyKey(value: string): boolean {
  return isSafeBoundedText(value, MAX_MANIFEST_KEY_LENGTH);
}

function isCanonicalRoutePath(value: string): boolean {
  if (
    !isSafeBoundedText(value, MAX_MANIFEST_KEY_LENGTH) ||
    !value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    (value.length > 1 && value.endsWith("/"))
  ) {
    return false;
  }

  if (value === "/") return true;
  const parts = value.slice(1).split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== "..");
}

function isCanonicalTimestamp(value: string): boolean {
  if (
    value.length > 64 ||
    !CANONICAL_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return false;
  }

  try {
    const canonical = new Date(value).toISOString();
    return canonical === value || canonical.replace(".000Z", "Z") === value;
  } catch {
    return false;
  }
}

function isSafeIntegerInRange(value: unknown, maximum: number): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum;
}

function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function recordEntryCountWithin(value: object, limit: number): boolean {
  return Object.keys(value).length <= limit;
}

// ---------------------------------------------------------------------------
// Extension-backed schema
// ---------------------------------------------------------------------------

const boundedIdentifierSchema = (v: SchemaValidator) =>
  v.string()
    .min(1)
    .max(MAX_IDENTIFIER_LENGTH)
    .refine((value) => isSafeBoundedText(value, MAX_IDENTIFIER_LENGTH));

const assetEntrySchema = (
  v: SchemaValidator,
  contentType: ReleaseAssetContentType,
) =>
  v.object({
    contentHash: v.string().regex(/^[0-9a-f]{64}$/),
    size: v.number().int().nonnegative().max(RELEASE_ASSET_MAX_SIZE_BYTES),
    contentType: v.literal(contentType),
  }).strict();

const routeEntrySchema = (v: SchemaValidator) =>
  v.object({
    modules: v.array(
      v.string()
        .min(1)
        .max(MAX_MANIFEST_KEY_LENGTH)
        .refine(isCanonicalModuleKey),
    )
      .max(MAX_ROUTE_MODULES)
      .refine(hasUniqueStrings),
    css: v.array(v.string().regex(/^[0-9a-f]{64}$/))
      .max(MAX_ROUTE_CSS_ENTRIES)
      .refine(hasUniqueStrings),
  }).strict();

interface ManifestReferenceShape {
  modules: Record<string, unknown>;
  css: Array<{ contentHash: string }>;
  routes: Record<string, { modules: string[]; css: string[] }>;
}

function hasValidManifestReferences(manifest: ManifestReferenceShape): boolean {
  const cssHashes = new Set(manifest.css.map((entry) => entry.contentHash));
  let referenceCount = 0;

  for (const route of Object.values(manifest.routes)) {
    referenceCount += route.modules.length + route.css.length;
    if (referenceCount > MAX_TOTAL_ROUTE_REFERENCES) return false;
    if (route.modules.some((modulePath) => !Object.hasOwn(manifest.modules, modulePath))) {
      return false;
    }
    if (route.css.some((contentHash) => !cssHashes.has(contentHash))) return false;
  }

  return true;
}

export const getReleaseAssetManifestSchema = defineSchema((v) =>
  v.object({
    schemaVersion: v.literal(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION),
    projectId: boundedIdentifierSchema(v),
    releaseId: boundedIdentifierSchema(v),
    releaseVersion: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    manifestVersion: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    builderVersion: v.string()
      .min(1)
      .max(MAX_BUILDER_VERSION_LENGTH)
      .refine((value) => isSafeBoundedText(value, MAX_BUILDER_VERSION_LENGTH)),
    sourceContentHash: v.string().regex(/^[0-9a-f]{64}$/),
    createdAt: v.string().max(64).refine(isCanonicalTimestamp),
    assetBasePath: v.literal(RELEASE_ASSET_BASE_PATH),
    modules: v.record(
      v.string().min(1).max(MAX_MANIFEST_KEY_LENGTH).refine(isCanonicalModuleKey),
      assetEntrySchema(v, RELEASE_ASSET_CONTENT_TYPES.js),
    ).refine((value) => recordEntryCountWithin(value, MAX_MODULE_ENTRIES)),
    css: v.array(
      v.object({
        contentHash: v.string().regex(/^[0-9a-f]{64}$/),
        size: v.number().int().nonnegative().max(RELEASE_ASSET_MAX_SIZE_BYTES),
        contentType: v.literal(RELEASE_ASSET_CONTENT_TYPES.css),
        styleProfileHash: v.string()
          .min(1)
          .max(MAX_STYLE_PROFILE_HASH_LENGTH)
          .refine((value) => isSafeBoundedText(value, MAX_STYLE_PROFILE_HASH_LENGTH))
          .nullable(),
      }).strict(),
    ).max(MAX_CSS_ENTRIES),
    routes: v.record(
      v.string().min(1).max(MAX_MANIFEST_KEY_LENGTH).refine(isCanonicalRoutePath),
      routeEntrySchema(v),
    ).refine((value) => recordEntryCountWithin(value, MAX_ROUTE_ENTRIES)),
    dependencies: v.record(
      v.string().min(1).max(MAX_MANIFEST_KEY_LENGTH).refine(isSafeDependencyKey),
      assetEntrySchema(v, RELEASE_ASSET_CONTENT_TYPES.js),
    ).refine((value) => recordEntryCountWithin(value, MAX_DEPENDENCY_ENTRIES)),
    fallback: v.object({
      mode: v.literal("jit"),
      gaps: v.array(
        v.string()
          .min(1)
          .max(MAX_GAP_LENGTH)
          .refine((value) => isSafeBoundedText(value, MAX_GAP_LENGTH)),
      ).max(MAX_FALLBACK_GAPS),
    }).strict(),
  }).strict().refine(hasValidManifestReferences, "Manifest route references must resolve")
);

// ---------------------------------------------------------------------------
// Inferred public types
// ---------------------------------------------------------------------------

export type ReleaseAssetManifest = InferSchema<
  ReturnType<typeof getReleaseAssetManifestSchema>
>;
export type ReleaseAssetEntry = ReleaseAssetManifest["modules"][string];
export type ReleaseAssetCssEntry = ReleaseAssetManifest["css"][number];
export type ReleaseAssetRouteEntry = ReleaseAssetManifest["routes"][string];

/** Manifest lifecycle states (DB-owned; mirrored here for runtime checks). */
export type ReleaseAssetManifestState =
  | "queued"
  | "building"
  | "partial"
  | "ready"
  | "failed"
  | "superseded";

/** Response shape for the GET asset-manifest endpoint. */
export interface ReleaseAssetManifestResponse {
  state: ReleaseAssetManifestState;
  manifest_version: number;
  manifest: ReleaseAssetManifest | null;
}

// ---------------------------------------------------------------------------
// Dependency-free consumption parser
// ---------------------------------------------------------------------------

/**
 * Parse an untrusted manifest without requiring a registered schema extension.
 *
 * The parser is non-throwing, applies explicit work and memory bounds, validates
 * route references, and returns a detached deeply frozen snapshot.
 */
export function parseReleaseAssetManifest(value: unknown): ReleaseAssetManifest | null {
  try {
    return parseReleaseAssetManifestImpl(value);
  } catch {
    return null;
  }
}

function parseReleaseAssetManifestImpl(value: unknown): ReleaseAssetManifest | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) return null;
  if (value.schemaVersion !== RELEASE_ASSET_MANIFEST_SCHEMA_VERSION) return null;
  if (!isSafeBoundedText(value.projectId, MAX_IDENTIFIER_LENGTH)) return null;
  if (!isSafeBoundedText(value.releaseId, MAX_IDENTIFIER_LENGTH)) return null;
  if (!isSafeIntegerInRange(value.releaseVersion, Number.MAX_SAFE_INTEGER)) return null;
  if (!isSafeIntegerInRange(value.manifestVersion, Number.MAX_SAFE_INTEGER)) return null;
  if (!isSafeBoundedText(value.builderVersion, MAX_BUILDER_VERSION_LENGTH)) return null;
  if (typeof value.sourceContentHash !== "string" || !isValidContentHash(value.sourceContentHash)) {
    return null;
  }
  if (typeof value.createdAt !== "string" || !isCanonicalTimestamp(value.createdAt)) return null;
  if (value.assetBasePath !== RELEASE_ASSET_BASE_PATH) return null;

  const modules = snapshotAssetRecord(
    value.modules,
    MAX_MODULE_ENTRIES,
    isCanonicalModuleKey,
    RELEASE_ASSET_CONTENT_TYPES.js,
  );
  if (!modules) return null;

  const dependencies = snapshotAssetRecord(
    value.dependencies,
    MAX_DEPENDENCY_ENTRIES,
    isSafeDependencyKey,
    RELEASE_ASSET_CONTENT_TYPES.js,
  );
  if (!dependencies) return null;

  const css = snapshotCssEntries(value.css);
  if (!css) return null;

  const routes = snapshotRoutes(value.routes);
  if (!routes) return null;

  const fallback = snapshotFallback(value.fallback);
  if (!fallback) return null;

  const manifest = Object.freeze({
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: value.projectId,
    releaseId: value.releaseId,
    releaseVersion: value.releaseVersion,
    manifestVersion: value.manifestVersion,
    builderVersion: value.builderVersion,
    sourceContentHash: value.sourceContentHash,
    createdAt: value.createdAt,
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules,
    css,
    routes,
    dependencies,
    fallback,
  }) satisfies ReleaseAssetManifest;

  return hasValidManifestReferences(manifest) ? manifest : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function snapshotAssetRecord(
  value: unknown,
  maxEntries: number,
  validateKey: (key: string) => boolean,
  contentType: ReleaseAssetContentType,
): Record<string, ReleaseAssetEntry> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > maxEntries) return null;

  const snapshot: Record<string, ReleaseAssetEntry> = Object.create(null);
  for (const key of keys) {
    if (!validateKey(key)) return null;
    const entry = snapshotAssetEntry(value[key], contentType);
    if (!entry) return null;
    Object.defineProperty(snapshot, key, {
      value: entry,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return Object.freeze(snapshot);
}

function snapshotAssetEntry(
  value: unknown,
  contentType: ReleaseAssetContentType,
): ReleaseAssetEntry | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ASSET_ENTRY_KEYS)) return null;
  if (typeof value.contentHash !== "string" || !isValidContentHash(value.contentHash)) return null;
  if (!isSafeIntegerInRange(value.size, RELEASE_ASSET_MAX_SIZE_BYTES)) return null;
  if (value.contentType !== contentType) return null;

  return Object.freeze({
    contentHash: value.contentHash,
    size: value.size,
    contentType,
  });
}

function snapshotCssEntries(value: unknown): ReleaseAssetCssEntry[] | null {
  if (!Array.isArray(value) || value.length > MAX_CSS_ENTRIES) return null;
  const entries: ReleaseAssetCssEntry[] = [];

  for (const candidate of value) {
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, CSS_ENTRY_KEYS)) return null;
    if (
      typeof candidate.contentHash !== "string" ||
      !isValidContentHash(candidate.contentHash) ||
      !isSafeIntegerInRange(candidate.size, RELEASE_ASSET_MAX_SIZE_BYTES) ||
      candidate.contentType !== RELEASE_ASSET_CONTENT_TYPES.css ||
      (candidate.styleProfileHash !== null &&
        !isSafeBoundedText(candidate.styleProfileHash, MAX_STYLE_PROFILE_HASH_LENGTH))
    ) {
      return null;
    }

    entries.push(Object.freeze({
      contentHash: candidate.contentHash,
      size: candidate.size,
      contentType: RELEASE_ASSET_CONTENT_TYPES.css,
      styleProfileHash: candidate.styleProfileHash,
    }));
  }

  return Object.freeze(entries) as ReleaseAssetCssEntry[];
}

function snapshotRoutes(value: unknown): Record<string, ReleaseAssetRouteEntry> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > MAX_ROUTE_ENTRIES) return null;

  const routes: Record<string, ReleaseAssetRouteEntry> = Object.create(null);
  for (const key of keys) {
    if (!isCanonicalRoutePath(key)) return null;
    const candidate = value[key];
    if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ROUTE_ENTRY_KEYS)) return null;

    const modules = snapshotStringArray(
      candidate.modules,
      MAX_ROUTE_MODULES,
      isCanonicalModuleKey,
    );
    const css = snapshotStringArray(
      candidate.css,
      MAX_ROUTE_CSS_ENTRIES,
      isValidContentHash,
    );
    if (!modules || !css) return null;

    Object.defineProperty(routes, key, {
      value: Object.freeze({ modules, css }),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }

  return Object.freeze(routes);
}

function snapshotFallback(
  value: unknown,
): ReleaseAssetManifest["fallback"] | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, FALLBACK_KEYS)) return null;
  if (value.mode !== "jit") return null;
  const gaps = snapshotStringArray(
    value.gaps,
    MAX_FALLBACK_GAPS,
    (gap) => isSafeBoundedText(gap, MAX_GAP_LENGTH),
    false,
  );
  return gaps ? Object.freeze({ mode: "jit" as const, gaps }) : null;
}

function snapshotStringArray(
  value: unknown,
  maximumLength: number,
  validate: (item: string) => boolean,
  requireUnique = true,
): string[] | null {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  const result: string[] = [];
  const seen = requireUnique ? new Set<string>() : null;

  for (const item of value) {
    if (typeof item !== "string" || !validate(item) || seen?.has(item)) return null;
    seen?.add(item);
    result.push(item);
  }

  return Object.freeze(result) as string[];
}
