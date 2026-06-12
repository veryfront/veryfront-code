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
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "./constants.ts";

// ---------------------------------------------------------------------------
// Schema fragments
// ---------------------------------------------------------------------------

const assetEntryShape = (v: SchemaValidator) => ({
  contentHash: v.string(),
  size: v.number(),
  contentType: v.string(),
});

const cssEntryShape = (v: SchemaValidator) => ({
  contentHash: v.string(),
  size: v.number(),
  contentType: v.string(),
  styleProfileHash: v.string().nullable(),
});

const routeEntryShape = (v: SchemaValidator) => ({
  modules: v.array(v.string()),
  css: v.array(v.string()),
});

const fallbackShape = (v: SchemaValidator) => ({
  mode: v.literal("jit"),
  gaps: v.array(v.string()),
});

// ---------------------------------------------------------------------------
// Exported schema getter
// ---------------------------------------------------------------------------

export const getReleaseAssetManifestSchema = defineSchema((v) =>
  v.object({
    schemaVersion: v.literal(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION),
    projectId: v.string(),
    releaseId: v.string(),
    releaseVersion: v.number(),
    manifestVersion: v.number(),
    builderVersion: v.string(),
    sourceContentHash: v.string(),
    createdAt: v.string(),
    assetBasePath: v.string(),
    modules: v.record(v.string(), v.object(assetEntryShape(v))),
    css: v.array(v.object(cssEntryShape(v))),
    routes: v.record(v.string(), v.object(routeEntryShape(v))),
    // `dependencies` is reserved for S7 vendoring — always {} in v1, but the
    // validator accepts entries shaped like `modules` values keyed by specifier.
    dependencies: v.record(v.string(), v.object(assetEntryShape(v))),
    fallback: v.object(fallbackShape(v)),
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
  if (!isRecord(value)) return null;
  if (value.schemaVersion !== RELEASE_ASSET_MANIFEST_SCHEMA_VERSION) return null;
  if (
    typeof value.projectId !== "string" ||
    typeof value.releaseId !== "string" ||
    typeof value.releaseVersion !== "number" ||
    typeof value.manifestVersion !== "number" ||
    typeof value.builderVersion !== "string" ||
    typeof value.sourceContentHash !== "string" ||
    typeof value.createdAt !== "string" ||
    typeof value.assetBasePath !== "string"
  ) {
    return null;
  }

  if (!isAssetEntryRecord(value.modules)) return null;
  if (!isAssetEntryRecord(value.dependencies)) return null;
  if (!Array.isArray(value.css) || !value.css.every(isCssEntry)) return null;
  if (!isRouteRecord(value.routes)) return null;
  if (!isFallback(value.fallback)) return null;

  return value as unknown as ReleaseAssetManifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.contentHash === "string" &&
    typeof value.size === "number" &&
    typeof value.contentType === "string"
  );
}

function isAssetEntryRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every(isAssetEntry);
}

function isCssEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.contentHash === "string" &&
    typeof value.size === "number" &&
    typeof value.contentType === "string" &&
    (value.styleProfileHash === null || typeof value.styleProfileHash === "string")
  );
}

function isRouteRecord(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return Object.values(value).every((entry) =>
    isRecord(entry) &&
    Array.isArray(entry.modules) &&
    entry.modules.every((m) => typeof m === "string") &&
    Array.isArray(entry.css) &&
    entry.css.every((c) => typeof c === "string")
  );
}

function isFallback(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.mode === "jit" &&
    Array.isArray(value.gaps) &&
    value.gaps.every((g) => typeof g === "string")
  );
}
