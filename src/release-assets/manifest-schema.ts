/**
 * Release Asset Manifest — v1 body schema, types, and validator.
 *
 * The manifest body is content-addressed metadata describing the transformed
 * browser modules and compiled CSS for a release, plus the per-route closure
 * used to drive preload hints and asset URL rewriting.
 *
 * Validation follows the repo's `defineSchema` convention (zod via the
 * `SchemaValidator` extension contract). The schema is materialized lazily so
 * core modules can import these types without pulling in the validator.
 *
 * @module release-assets/manifest-schema
 */

import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "veryfront/extensions/schema";
import {
  isValidContentHash,
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
} from "./constants.ts";

const MAX_MANIFEST_TOP_LEVEL_FIELDS = 64;
const MAX_MANIFEST_RECORD_ENTRIES = 10_000;
const MAX_MANIFEST_CSS_ENTRIES = 512;
const MAX_MANIFEST_ROUTE_REFERENCES = 10_000;
const MAX_MANIFEST_TOTAL_ROUTE_REFERENCES = 50_000;
const MAX_MANIFEST_GAPS = 10_000;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_BUILDER_VERSION_BYTES = 128;
const MAX_SOURCE_HASH_BYTES = 256;
const MAX_TIMESTAMP_BYTES = 64;
const MAX_GAP_BYTES = 2_048;
const MAX_STYLE_PROFILE_HASH_BYTES = 128;
const ASSET_ENTRY_FIELD_LIMIT = 16;
const ROUTE_ENTRY_FIELD_LIMIT = 8;
const FALLBACK_FIELD_LIMIT = 8;

function isManifestJavaScriptContentType(value: unknown): value is string {
  // `application/javascript` exists in older manifests. New uploads use the
  // canonical `text/javascript`, but consumption remains backward-compatible.
  return value === RELEASE_ASSET_CONTENT_TYPES.js || value === "application/javascript";
}

/** Parsed manifests are detached immutable snapshots and can be reused safely. */
const canonicalManifests = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Schema fragments
// ---------------------------------------------------------------------------

const assetEntryShape = (v: SchemaValidator) => ({
  contentHash: v.string().regex(/^[0-9a-f]{64}$/),
  size: v.number().int().nonnegative().max(RELEASE_ASSET_MAX_SIZE_BYTES),
  contentType: v.string().refine(isManifestJavaScriptContentType),
});

const cssEntryShape = (v: SchemaValidator) => ({
  contentHash: v.string().regex(/^[0-9a-f]{64}$/),
  size: v.number().int().nonnegative().max(RELEASE_ASSET_MAX_SIZE_BYTES),
  contentType: v.string().refine((value) => value === RELEASE_ASSET_CONTENT_TYPES.css),
  styleProfileHash: v.string().max(MAX_STYLE_PROFILE_HASH_BYTES)
    .refine((value) => isBoundedText(value, MAX_STYLE_PROFILE_HASH_BYTES, true)).nullable(),
});

const routeEntryShape = (v: SchemaValidator) => ({
  modules: v.array(
    v.string().max(RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES).refine(isLogicalModulePath),
  ).max(MAX_MANIFEST_ROUTE_REFERENCES),
  css: v.array(v.string().regex(/^[0-9a-f]{64}$/)).max(MAX_MANIFEST_ROUTE_REFERENCES),
});

const fallbackShape = (v: SchemaValidator) => ({
  mode: v.literal("jit"),
  gaps: v.array(
    v.string().max(MAX_GAP_BYTES).refine((value) => isBoundedText(value, MAX_GAP_BYTES, true)),
  ).max(MAX_MANIFEST_GAPS),
});

// ---------------------------------------------------------------------------
// Exported schema getter
// ---------------------------------------------------------------------------

export const getReleaseAssetManifestSchema = defineSchema((v) =>
  v.object({
    schemaVersion: v.literal(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION),
    projectId: v.string().min(1).max(MAX_IDENTIFIER_BYTES)
      .refine((value) => isBoundedText(value, MAX_IDENTIFIER_BYTES)),
    releaseId: v.string().min(1).max(MAX_IDENTIFIER_BYTES)
      .refine((value) => isBoundedText(value, MAX_IDENTIFIER_BYTES)),
    releaseVersion: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    manifestVersion: v.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    builderVersion: v.string().min(1).max(MAX_BUILDER_VERSION_BYTES)
      .refine((value) => isBoundedText(value, MAX_BUILDER_VERSION_BYTES)),
    sourceContentHash: v.string().max(MAX_SOURCE_HASH_BYTES)
      .refine((value) => isBoundedText(value, MAX_SOURCE_HASH_BYTES, true)),
    createdAt: v.string().max(MAX_TIMESTAMP_BYTES).datetime(),
    assetBasePath: v.string().refine((value) => value === RELEASE_ASSET_BASE_PATH),
    modules: v.record(
      v.string().max(RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES).refine(isLogicalModulePath),
      v.object(assetEntryShape(v)).strip(),
    ).refine((entries) => Object.keys(entries).length <= MAX_MANIFEST_RECORD_ENTRIES),
    css: v.array(v.object(cssEntryShape(v)).strip()).max(MAX_MANIFEST_CSS_ENTRIES),
    routes: v.record(
      v.string().max(RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES).refine(isRoutePath),
      v.object(routeEntryShape(v)).strip(),
    ).refine((entries) => Object.keys(entries).length <= MAX_MANIFEST_RECORD_ENTRIES),
    // `dependencies` records framework dependency artifacts for future S7
    // vendoring. HTML keeps import-map entries on module URLs until those
    // artifacts include their own rewritten import closures.
    dependencies: v.record(
      v.string().max(RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES).refine(isDependencySpecifier),
      v.object(assetEntryShape(v)).strip(),
    ).refine((entries) => Object.keys(entries).length <= MAX_MANIFEST_RECORD_ENTRIES),
    fallback: v.object(fallbackShape(v)).strip(),
  }).strip().superRefine((manifest, context) => {
    const cssHashes = new Set(manifest.css.map((entry) => entry.contentHash));
    let totalReferences = 0;
    for (const [route, closure] of Object.entries(manifest.routes)) {
      totalReferences += closure.modules.length + closure.css.length;
      if (totalReferences > MAX_MANIFEST_TOTAL_ROUTE_REFERENCES) {
        context.addIssue({ message: "Release route closures exceed the reference limit" });
        break;
      }
      for (const modulePath of closure.modules) {
        if (!Object.hasOwn(manifest.modules, modulePath)) {
          context.addIssue({
            message: "Release route references an unknown module",
            path: ["routes", route, "modules"],
          });
        }
      }
      for (const contentHash of closure.css) {
        if (!cssHashes.has(contentHash)) {
          context.addIssue({
            message: "Release route references unknown CSS",
            path: ["routes", route, "css"],
          });
        }
      }
    }
  })
);

// ---------------------------------------------------------------------------
// Inferred types
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

/**
 * Hand-rolled structural validator.
 *
 * Used on consumption paths (HTML/proxy) where the `SchemaValidator` extension
 * may not be registered. Returns the typed manifest on success, or null. Does
 * not throw — consumption is always best-effort with a JIT fallback.
 */
export function parseReleaseAssetManifest(value: unknown): ReleaseAssetManifest | null {
  if (isRecord(value) && canonicalManifests.has(value)) {
    return value as unknown as ReleaseAssetManifest;
  }

  const fields = snapshotDataRecord(value, MAX_MANIFEST_TOP_LEVEL_FIELDS);
  if (!fields) return null;

  const schemaVersion = fields.get("schemaVersion");
  const projectId = fields.get("projectId");
  const releaseId = fields.get("releaseId");
  const releaseVersion = fields.get("releaseVersion");
  const manifestVersion = fields.get("manifestVersion");
  const builderVersion = fields.get("builderVersion");
  const sourceContentHash = fields.get("sourceContentHash");
  const createdAt = fields.get("createdAt");
  const assetBasePath = fields.get("assetBasePath");

  if (
    schemaVersion !== RELEASE_ASSET_MANIFEST_SCHEMA_VERSION ||
    !isBoundedText(projectId, MAX_IDENTIFIER_BYTES) ||
    !isBoundedText(releaseId, MAX_IDENTIFIER_BYTES) ||
    !isNonNegativeSafeInteger(releaseVersion) ||
    !isNonNegativeSafeInteger(manifestVersion) ||
    !isBoundedText(builderVersion, MAX_BUILDER_VERSION_BYTES) ||
    !isBoundedText(sourceContentHash, MAX_SOURCE_HASH_BYTES, true) ||
    !isTimestamp(createdAt) ||
    assetBasePath !== RELEASE_ASSET_BASE_PATH
  ) {
    return null;
  }

  const modules = parseAssetEntryRecord(
    fields.get("modules"),
    isLogicalModulePath,
  );
  const dependencies = parseAssetEntryRecord(
    fields.get("dependencies"),
    isDependencySpecifier,
  );
  const css = parseCssEntries(fields.get("css"));
  if (!modules || !dependencies || !css) return null;

  const routes = parseRouteEntries(fields.get("routes"), modules, css);
  const fallback = parseFallback(fields.get("fallback"));
  if (!routes || !fallback) return null;

  const manifest = Object.freeze({
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId,
    releaseId,
    releaseVersion,
    manifestVersion,
    builderVersion,
    sourceContentHash,
    createdAt,
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules,
    css,
    routes,
    dependencies,
    fallback,
  }) as unknown as ReleaseAssetManifest;
  canonicalManifests.add(manifest);
  return manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function snapshotDataRecord(
  value: unknown,
  maxEntries: number,
): Map<string, unknown> | null {
  if (!isRecord(value)) return null;

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length > maxEntries) return null;

    const entries = new Map<string, unknown>();
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
        !("value" in descriptor)
      ) {
        return null;
      }
      entries.set(key, descriptor.value);
    }
    return entries;
  } catch {
    return null;
  }
}

function snapshotDataArray(value: unknown, maxLength: number): unknown[] | null {
  if (!Array.isArray(value)) return null;

  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor?.value;
    if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) return null;
    if (length > maxLength) return null;

    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1) return null;

    const snapshot: unknown[] = [];
    for (let index = 0; index < length; index++) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (
        !descriptor || !descriptor.enumerable || descriptor.get || descriptor.set ||
        !("value" in descriptor)
      ) {
        return null;
      }
      snapshot.push(descriptor.value);
    }
    return snapshot;
  } catch {
    return null;
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function utf8ByteLengthAtMost(value: string, maximum: number): boolean {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    if (bytes > maximum) return false;
  }
  return true;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isBoundedText(
  value: unknown,
  maxBytes: number,
  allowEmpty = false,
): value is string {
  return typeof value === "string" &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxBytes &&
    !hasControlCharacter(value) &&
    utf8ByteLengthAtMost(value, maxBytes);
}

function isTimestamp(value: unknown): value is string {
  return isBoundedText(value, MAX_TIMESTAMP_BYTES) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isLogicalModulePath(value: string): boolean {
  if (
    !isBoundedText(value, RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES) || value.startsWith("/") ||
    value.includes("\\") || value.includes("?") || value.includes("#") ||
    !/\.(?:tsx|ts|jsx|js|mdx)$/.test(value)
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isDependencySpecifier(value: string): boolean {
  return isBoundedText(value, RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES);
}

function isRoutePath(value: string): boolean {
  if (
    !isBoundedText(value, RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES) || !value.startsWith("/") ||
    value.startsWith("//") || value.includes("\\") || value.includes("?") || value.includes("#")
  ) {
    return false;
  }
  return value === "/" || value.slice(1).split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function immutableRecord<T>(entries: Iterable<readonly [string, T]>): Record<string, T> {
  const record = Object.create(null) as Record<string, T>;
  for (const [key, value] of entries) {
    Object.defineProperty(record, key, {
      configurable: false,
      enumerable: true,
      writable: false,
      value,
    });
  }
  return Object.freeze(record);
}

function parseJavaScriptAssetEntry(value: unknown): ReleaseAssetEntry | null {
  const fields = snapshotDataRecord(value, ASSET_ENTRY_FIELD_LIMIT);
  if (!fields) return null;

  const contentHash = fields.get("contentHash");
  const size = fields.get("size");
  const contentType = fields.get("contentType");
  if (
    typeof contentHash !== "string" || !isValidContentHash(contentHash) ||
    !isNonNegativeSafeInteger(size) || size > RELEASE_ASSET_MAX_SIZE_BYTES ||
    !isManifestJavaScriptContentType(contentType)
  ) {
    return null;
  }

  return Object.freeze({ contentHash, size, contentType });
}

function parseAssetEntryRecord(
  value: unknown,
  isValidKey: (key: string) => boolean,
): Record<string, ReleaseAssetEntry> | null {
  const entries = snapshotDataRecord(value, MAX_MANIFEST_RECORD_ENTRIES);
  if (!entries) return null;

  const parsed: Array<readonly [string, ReleaseAssetEntry]> = [];
  for (const [key, rawEntry] of entries) {
    if (!isValidKey(key)) return null;
    const entry = parseJavaScriptAssetEntry(rawEntry);
    if (!entry) return null;
    parsed.push([key, entry]);
  }
  return immutableRecord(parsed);
}

function parseCssEntries(value: unknown): ReleaseAssetManifest["css"] | null {
  const entries = snapshotDataArray(value, MAX_MANIFEST_CSS_ENTRIES);
  if (!entries) return null;

  const parsed: ReleaseAssetCssEntry[] = [];
  for (const rawEntry of entries) {
    const fields = snapshotDataRecord(rawEntry, ASSET_ENTRY_FIELD_LIMIT);
    if (!fields) return null;

    const contentHash = fields.get("contentHash");
    const size = fields.get("size");
    const styleProfileHash = fields.get("styleProfileHash");
    if (
      typeof contentHash !== "string" || !isValidContentHash(contentHash) ||
      !isNonNegativeSafeInteger(size) || size > RELEASE_ASSET_MAX_SIZE_BYTES ||
      fields.get("contentType") !== RELEASE_ASSET_CONTENT_TYPES.css ||
      (styleProfileHash !== null &&
        !isBoundedText(styleProfileHash, MAX_STYLE_PROFILE_HASH_BYTES, true))
    ) {
      return null;
    }

    parsed.push(Object.freeze({
      contentHash,
      size,
      contentType: RELEASE_ASSET_CONTENT_TYPES.css,
      styleProfileHash,
    }));
  }
  return Object.freeze(parsed) as unknown as ReleaseAssetManifest["css"];
}

function parseStringArray(
  value: unknown,
  maximum: number,
  predicate: (entry: string) => boolean,
): string[] | null {
  const entries = snapshotDataArray(value, maximum);
  if (!entries) return null;

  const parsed: string[] = [];
  for (const entry of entries) {
    if (typeof entry !== "string" || !predicate(entry)) return null;
    parsed.push(entry);
  }
  return Object.freeze(parsed) as unknown as string[];
}

function parseRouteEntries(
  value: unknown,
  modules: ReleaseAssetManifest["modules"],
  css: ReleaseAssetManifest["css"],
): ReleaseAssetManifest["routes"] | null {
  const entries = snapshotDataRecord(value, MAX_MANIFEST_RECORD_ENTRIES);
  if (!entries) return null;

  const cssHashes = new Set(css.map((entry) => entry.contentHash));
  const parsed: Array<readonly [string, ReleaseAssetRouteEntry]> = [];
  let totalReferences = 0;

  for (const [route, rawEntry] of entries) {
    if (!isRoutePath(route)) return null;
    const fields = snapshotDataRecord(rawEntry, ROUTE_ENTRY_FIELD_LIMIT);
    if (!fields) return null;

    const routeModules = parseStringArray(
      fields.get("modules"),
      MAX_MANIFEST_ROUTE_REFERENCES,
      (modulePath) => isLogicalModulePath(modulePath) && Object.hasOwn(modules, modulePath),
    );
    const routeCss = parseStringArray(
      fields.get("css"),
      MAX_MANIFEST_ROUTE_REFERENCES,
      (contentHash) => isValidContentHash(contentHash) && cssHashes.has(contentHash),
    );
    if (!routeModules || !routeCss) return null;

    totalReferences += routeModules.length + routeCss.length;
    if (totalReferences > MAX_MANIFEST_TOTAL_ROUTE_REFERENCES) return null;
    parsed.push([route, Object.freeze({ modules: routeModules, css: routeCss })]);
  }

  return immutableRecord(parsed);
}

function parseFallback(value: unknown): ReleaseAssetManifest["fallback"] | null {
  const fields = snapshotDataRecord(value, FALLBACK_FIELD_LIMIT);
  if (!fields || fields.get("mode") !== "jit") return null;

  const gaps = parseStringArray(
    fields.get("gaps"),
    MAX_MANIFEST_GAPS,
    (gap) => isBoundedText(gap, MAX_GAP_BYTES, true),
  );
  return gaps ? Object.freeze({ mode: "jit" as const, gaps }) : null;
}
