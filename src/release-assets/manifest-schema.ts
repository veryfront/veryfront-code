/**
 * Release Asset Manifest — v2 body schema, types, and validator.
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
  isCSSPipelineIdentity,
  isStyleProfileHash,
} from "#veryfront/utils/css-artifact-identity.ts";
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
  cssPipelineIdentityLength: MAX_CSS_PIPELINE_IDENTITY_LENGTH,
  moduleEntries: MAX_MODULE_ENTRIES,
  dependencyEntries: MAX_DEPENDENCY_ENTRIES,
  cssEntries: MAX_CSS_ENTRIES,
  routeEntries: MAX_ROUTE_ENTRIES,
  routeModules: MAX_ROUTE_MODULES,
  routeCssEntries: MAX_ROUTE_CSS_ENTRIES,
  totalRouteReferences: MAX_TOTAL_ROUTE_REFERENCES,
} = RELEASE_ASSET_MANIFEST_LIMITS;
const MODULE_EXTENSION_PATTERN = /\.(?:tsx?|jsx?|mdx)$/;
const CANONICAL_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const RELEASE_ASSET_DEPENDENCY_MODES = ["source", "immutable"] as const;

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
  "dependencyMode",
  "dependencies",
]);
/**
 * Key set of the v1 body still held in storage for every release published
 * before the v2 move. v1 carried `fallback` and had no `dependencyMode`.
 */
const LEGACY_V1_MANIFEST_KEYS = new Set([
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
const LEGACY_V1_SCHEMA_VERSION = 1;

const ASSET_ENTRY_KEYS = new Set(["contentHash", "size", "contentType"]);
const CSS_ENTRY_KEYS = new Set([
  "contentHash",
  "size",
  "contentType",
  "styleProfileHash",
  "cssPipelineIdentity",
]);
const ROUTE_ENTRY_KEYS = new Set(["modules", "css"]);

/**
 * Check that an untrusted value is a non-empty, trimmed string within
 * `maxLength` that contains no control characters.
 */
export function isSafeBoundedText(value: unknown, maxLength: number): value is string {
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

/** Extension-backed validator for the strict release asset manifest v2 body. */
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
          .min(MAX_STYLE_PROFILE_HASH_LENGTH)
          .max(MAX_STYLE_PROFILE_HASH_LENGTH)
          .refine(isStyleProfileHash),
        cssPipelineIdentity: v.string()
          .min(1)
          .max(MAX_CSS_PIPELINE_IDENTITY_LENGTH)
          .refine(isCSSPipelineIdentity),
      }).strict(),
    ).max(MAX_CSS_ENTRIES),
    routes: v.record(
      v.string().min(1).max(MAX_MANIFEST_KEY_LENGTH).refine(isCanonicalRoutePath),
      routeEntrySchema(v),
    ).refine((value) => recordEntryCountWithin(value, MAX_ROUTE_ENTRIES)),
    dependencyMode: v.enum(RELEASE_ASSET_DEPENDENCY_MODES),
    dependencies: v.record(
      v.string().min(1).max(MAX_MANIFEST_KEY_LENGTH).refine(isSafeDependencyKey),
      assetEntrySchema(v, RELEASE_ASSET_CONTENT_TYPES.js),
    ).refine((value) => recordEntryCountWithin(value, MAX_DEPENDENCY_ENTRIES)),
  }).strict().refine(hasValidManifestReferences, "Manifest route references must resolve")
);

// ---------------------------------------------------------------------------
// Inferred public types
// ---------------------------------------------------------------------------

/** Validated, immutable release asset manifest v2 body. */
export type ReleaseAssetManifest = InferSchema<
  ReturnType<typeof getReleaseAssetManifestSchema>
>;
/** Content-addressed JavaScript module entry. */
export type ReleaseAssetEntry = ReleaseAssetManifest["modules"][string];
/** Content-addressed CSS entry. */
export type ReleaseAssetCssEntry = ReleaseAssetManifest["css"][number];
/** Per-route module and CSS closure. */
export type ReleaseAssetRouteEntry = ReleaseAssetManifest["routes"][string];
/** Capability represented by entries in the manifest dependency map. */
export type ReleaseAssetDependencyMode = ReleaseAssetManifest["dependencyMode"];
/** Manifest whose dependency entries name uploaded content-addressed assets. */
export type ImmutableReleaseAssetManifest = ReleaseAssetManifest & {
  readonly dependencyMode: "immutable";
};

/** True only when manifest dependency entries are safe immutable rewrite targets. */
export function hasImmutableReleaseAssetDependencies(
  manifest: ReleaseAssetManifest | null | undefined,
): manifest is ImmutableReleaseAssetManifest {
  return manifest?.dependencyMode === "immutable";
}

/** Manifest lifecycle states (DB-owned; mirrored here for runtime checks). */
export type ReleaseAssetManifestState =
  | "queued"
  | "building"
  | "ready"
  | "partial"
  | "failed"
  | "superseded";

/** Response shape for the GET asset-manifest endpoint. */
export interface ReleaseAssetManifestResponse {
  state: ReleaseAssetManifestState;
  manifest_version: number;
  manifest: ReleaseAssetManifest | null;
}

/** Strict ready response with a generation-matched validated manifest body. */
export interface ReadyReleaseAssetManifestResponse {
  readonly state: "ready";
  readonly manifest_version: number;
  readonly manifest: ReleaseAssetManifest;
}

// ---------------------------------------------------------------------------
// Dependency-free consumption parser
// ---------------------------------------------------------------------------

/**
 * Options shared by the dependency-free consumption parsers. `acceptLegacyV1`
 * defaults to `false`, so a v1 manifest body is rejected as a schema skew; set
 * it to `true` only on read paths that must still adapt a readable v1 manifest.
 */
export interface ReleaseAssetManifestParseOptions {
  /**
   * Accept the v1 body still held for releases published before the v2 move.
   *
   * Off by default, and deliberately opt-in per call site.
   *
   * Runtime reads must set it, or every release published before the v2 move
   * loses its browser modules. Producer-side callers must not: for the build
   * executor verifying what it just emitted, the CLI waiting on a deploy, or a
   * locally built bundle, a v1 body means the builder and this framework are
   * skewed, and accepting it would hide that skew instead of naming it.
   *
   * @default false
   */
  readonly acceptLegacyV1?: boolean;
}

/**
 * Parse an untrusted manifest without requiring a registered schema extension.
 *
 * The parser is non-throwing, applies explicit work and memory bounds, validates
 * route references, and returns a detached deeply frozen snapshot.
 */
export function parseReleaseAssetManifest(
  value: unknown,
  options: ReleaseAssetManifestParseOptions = {},
): ReleaseAssetManifest | null {
  try {
    return parseReleaseAssetManifestImpl(value, options.acceptLegacyV1 === true);
  } catch {
    return null;
  }
}

/**
 * Parse an untrusted ready response without executing accessors.
 *
 * The response envelope and manifest body must identify the same release and
 * manifest generation. Extra envelope fields are ignored so the control plane
 * can add unrelated metadata without weakening these identity checks.
 */
export function parseReadyReleaseAssetManifestResponse(
  value: unknown,
  expectedReleaseId: string,
  options: ReleaseAssetManifestParseOptions = {},
): ReadyReleaseAssetManifestResponse | null {
  try {
    if (!isSafeBoundedText(expectedReleaseId, MAX_IDENTIFIER_LENGTH)) return null;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

    const state = readOwnDataProperty(value, "state");
    const manifestVersion = readOwnDataProperty(value, "manifest_version");
    const manifest = parseReleaseAssetManifest(readOwnDataProperty(value, "manifest"), options);
    if (
      state !== "ready" ||
      !isSafeIntegerInRange(manifestVersion, Number.MAX_SAFE_INTEGER) ||
      !manifest ||
      manifest.releaseId !== expectedReleaseId ||
      manifest.manifestVersion !== manifestVersion
    ) {
      return null;
    }

    return Object.freeze({
      state: "ready",
      manifest_version: manifestVersion,
      manifest,
    });
  } catch {
    return null;
  }
}

/**
 * Explain why a ready manifest response was rejected.
 *
 * `parseReadyReleaseAssetManifestResponse` returns null for five distinct
 * reasons, which left operators with "invalid or mismatched" and no way to tell
 * a stale build from a corrupt payload. The commonest cause by far is version
 * skew: assets built by a framework older than the reader expect a different
 * schema, and the remedy is to deploy a newer builder, not to rebuild against
 * the same one.
 *
 * Only bounded, self-produced text is returned. Untrusted values are reported
 * as their shape or as a bounded integer, never echoed.
 */
export function describeReadyReleaseAssetManifestRejection(
  value: unknown,
  expectedReleaseId: string,
  options: ReleaseAssetManifestParseOptions = {},
): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "the response envelope was not an object";
  }

  const manifestVersion = readUntrustedOwnDataProperty(value, "manifest_version");
  if (!isSafeIntegerInRange(manifestVersion, Number.MAX_SAFE_INTEGER)) {
    return "the response envelope carried no usable manifest_version";
  }

  const body = readUntrustedOwnDataProperty(value, "manifest");
  const manifest = parseReleaseAssetManifest(body, options);
  if (!manifest) {
    const schemaVersion = readUntrustedOwnDataProperty(body, "schemaVersion");
    // Which versions count as skew depends on what this caller reads. A
    // producer-side caller reads v2 only, so a v1 body there is a genuine
    // framework skew. A runtime read also accepts v1, so a v1 body that still
    // fails is corrupt -- calling that a skew would send operators to upgrade
    // the builder for something an upgrade cannot fix.
    const acceptsLegacyV1 = options.acceptLegacyV1 === true;
    if (
      isSafeIntegerInRange(schemaVersion, Number.MAX_SAFE_INTEGER) &&
      schemaVersion !== RELEASE_ASSET_MANIFEST_SCHEMA_VERSION &&
      !(acceptsLegacyV1 && schemaVersion === LEGACY_V1_SCHEMA_VERSION)
    ) {
      const readable = acceptsLegacyV1
        ? `versions ${LEGACY_V1_SCHEMA_VERSION} and ${RELEASE_ASSET_MANIFEST_SCHEMA_VERSION}`
        : `version ${RELEASE_ASSET_MANIFEST_SCHEMA_VERSION}`;
      return `the release assets declare manifest schema version ${schemaVersion}, but this ` +
        `framework reads ${readable}. The assets were built ` +
        `by a different framework version than the one reading them`;
    }
    return "the manifest body did not match the expected schema";
  }

  if (manifest.releaseId !== expectedReleaseId) {
    return "the manifest identifies a different release than the one requested";
  }
  if (manifest.manifestVersion !== manifestVersion) {
    return "the envelope and manifest body disagree on the manifest version";
  }

  return "the manifest failed validation for an unrecognized reason";
}

/**
 * Read an own data property from an untrusted value without invoking accessors.
 *
 * Returns undefined for primitives, accessor-backed properties, and values
 * whose property inspection throws (for example hostile proxies).
 */
export function readUntrustedOwnDataProperty(value: unknown, key: PropertyKey): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return readOwnDataProperty(value, key);
  } catch {
    return undefined;
  }
}

/**
 * Parse an untrusted body, tolerating the v1 shape still held in storage.
 *
 * Consumption must read what was published, not only what the current builder
 * emits: every release predating the v2 move stored a v1 body, and refusing
 * those takes the whole release's browser modules offline. Production stays
 * strict — `getReleaseAssetManifestSchema` is v2-only, so no new v1 can be
 * written — while reads adapt the old shape and then apply the full v2
 * validator to it. The adapter only reshapes; it never validates.
 */
function parseReleaseAssetManifestImpl(
  value: unknown,
  acceptLegacyV1: boolean,
): ReleaseAssetManifest | null {
  const current = parseCurrentManifestBody(value);
  if (current || !acceptLegacyV1) return current;

  const adapted = adaptLegacyV1ManifestBody(value);
  return adapted ? parseCurrentManifestBody(adapted) : null;
}

/**
 * Reshape a v1 body into the v2 shape, or null when it is not a v1 body.
 *
 * `fallback` is dropped (nothing reads it) and `dependencyMode` is reported as
 * `source`, which is what v1's always-empty `dependencies` means. CSS is
 * dropped entirely: a v1 entry carries no `cssPipelineIdentity` and a
 * short-token `styleProfileHash`, and both are cache-correctness keys that
 * cannot be recovered from the stored artifact. Reporting no manifest CSS
 * routes styling back through the renderer's own pipeline, which is the
 * documented per-entry fallback; fabricating the identities would risk serving
 * the wrong stylesheet. Route CSS references are cleared with it so the
 * reference check still resolves.
 */
function adaptLegacyV1ManifestBody(value: unknown): Record<string, unknown> | null {
  const candidate = snapshotExactDataRecord(value, LEGACY_V1_MANIFEST_KEYS);
  if (!candidate) return null;
  if (candidate.schemaVersion !== LEGACY_V1_SCHEMA_VERSION) return null;

  const routes = adaptLegacyV1Routes(candidate.routes);
  if (!routes) return null;

  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: candidate.projectId,
    releaseId: candidate.releaseId,
    releaseVersion: candidate.releaseVersion,
    manifestVersion: candidate.manifestVersion,
    builderVersion: candidate.builderVersion,
    sourceContentHash: candidate.sourceContentHash,
    createdAt: candidate.createdAt,
    assetBasePath: candidate.assetBasePath,
    modules: candidate.modules,
    css: [],
    routes,
    dependencyMode: "source",
    dependencies: candidate.dependencies,
  };
}

/** Copy v1 route entries with their CSS closure cleared. */
function adaptLegacyV1Routes(value: unknown): Record<string, unknown> | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length > MAX_ROUTE_ENTRIES) return null;

  // Null-prototype: route keys are untrusted, and assigning a key of
  // `__proto__` onto a plain object hits the prototype setter instead of
  // creating an own property. `snapshotRoutes` uses the same guard.
  const routes: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const entry = readUntrustedOwnDataProperty(value, key);
    if (!isPlainRecord(entry)) return null;
    routes[key] = { modules: readUntrustedOwnDataProperty(entry, "modules"), css: [] };
  }
  return routes;
}

function parseCurrentManifestBody(value: unknown): ReleaseAssetManifest | null {
  const candidate = snapshotExactDataRecord(value, MANIFEST_KEYS);
  if (!candidate) return null;
  if (candidate.schemaVersion !== RELEASE_ASSET_MANIFEST_SCHEMA_VERSION) return null;
  if (!isSafeBoundedText(candidate.projectId, MAX_IDENTIFIER_LENGTH)) return null;
  if (!isSafeBoundedText(candidate.releaseId, MAX_IDENTIFIER_LENGTH)) return null;
  if (!isSafeIntegerInRange(candidate.releaseVersion, Number.MAX_SAFE_INTEGER)) return null;
  if (!isSafeIntegerInRange(candidate.manifestVersion, Number.MAX_SAFE_INTEGER)) return null;
  if (!isSafeBoundedText(candidate.builderVersion, MAX_BUILDER_VERSION_LENGTH)) return null;
  if (
    typeof candidate.sourceContentHash !== "string" ||
    !isValidContentHash(candidate.sourceContentHash)
  ) {
    return null;
  }
  if (
    typeof candidate.createdAt !== "string" ||
    !isCanonicalTimestamp(candidate.createdAt)
  ) return null;
  if (candidate.assetBasePath !== RELEASE_ASSET_BASE_PATH) return null;
  if (
    candidate.dependencyMode !== "source" &&
    candidate.dependencyMode !== "immutable"
  ) return null;

  const modules = snapshotAssetRecord(
    candidate.modules,
    MAX_MODULE_ENTRIES,
    isCanonicalModuleKey,
    RELEASE_ASSET_CONTENT_TYPES.js,
  );
  if (!modules) return null;

  const dependencies = snapshotAssetRecord(
    candidate.dependencies,
    MAX_DEPENDENCY_ENTRIES,
    isSafeDependencyKey,
    RELEASE_ASSET_CONTENT_TYPES.js,
  );
  if (!dependencies) return null;

  const css = snapshotCssEntries(candidate.css);
  if (!css) return null;

  const routes = snapshotRoutes(candidate.routes);
  if (!routes) return null;

  const manifest = Object.freeze({
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: candidate.projectId,
    releaseId: candidate.releaseId,
    releaseVersion: candidate.releaseVersion,
    manifestVersion: candidate.manifestVersion,
    builderVersion: candidate.builderVersion,
    sourceContentHash: candidate.sourceContentHash,
    createdAt: candidate.createdAt,
    assetBasePath: RELEASE_ASSET_BASE_PATH,
    modules,
    css,
    routes,
    dependencyMode: candidate.dependencyMode,
    dependencies,
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

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function snapshotExactDataRecord(
  value: unknown,
  expected: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, expected)) return null;

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function boundedArrayLength(value: unknown, maximumLength: number): number | null {
  if (!Array.isArray(value)) return null;
  const length = readOwnDataProperty(value, "length");
  return isSafeIntegerInRange(length, maximumLength) ? length : null;
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
    const entry = snapshotAssetEntry(readOwnDataProperty(value, key), contentType);
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
  const candidate = snapshotExactDataRecord(value, ASSET_ENTRY_KEYS);
  if (!candidate) return null;
  if (
    typeof candidate.contentHash !== "string" ||
    !isValidContentHash(candidate.contentHash)
  ) return null;
  if (!isSafeIntegerInRange(candidate.size, RELEASE_ASSET_MAX_SIZE_BYTES)) return null;
  if (candidate.contentType !== contentType) return null;

  return Object.freeze({
    contentHash: candidate.contentHash,
    size: candidate.size,
    contentType,
  });
}

function snapshotCssEntries(value: unknown): ReleaseAssetCssEntry[] | null {
  const length = boundedArrayLength(value, MAX_CSS_ENTRIES);
  if (length === null) return null;
  const entries: ReleaseAssetCssEntry[] = [];

  for (let index = 0; index < length; index++) {
    const candidate = snapshotExactDataRecord(
      readOwnDataProperty(value as unknown[], index),
      CSS_ENTRY_KEYS,
    );
    if (!candidate) return null;
    if (
      typeof candidate.contentHash !== "string" ||
      !isValidContentHash(candidate.contentHash) ||
      !isSafeIntegerInRange(candidate.size, RELEASE_ASSET_MAX_SIZE_BYTES) ||
      candidate.contentType !== RELEASE_ASSET_CONTENT_TYPES.css ||
      !isStyleProfileHash(candidate.styleProfileHash) ||
      !isCSSPipelineIdentity(candidate.cssPipelineIdentity)
    ) {
      return null;
    }

    entries.push(Object.freeze({
      contentHash: candidate.contentHash,
      size: candidate.size,
      contentType: RELEASE_ASSET_CONTENT_TYPES.css,
      styleProfileHash: candidate.styleProfileHash,
      cssPipelineIdentity: candidate.cssPipelineIdentity,
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
    const candidate = snapshotExactDataRecord(
      readOwnDataProperty(value, key),
      ROUTE_ENTRY_KEYS,
    );
    if (!candidate) return null;

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

function snapshotStringArray(
  value: unknown,
  maximumLength: number,
  validate: (item: string) => boolean,
  requireUnique = true,
): string[] | null {
  const length = boundedArrayLength(value, maximumLength);
  if (length === null) return null;
  const result: string[] = [];
  const seen = requireUnique ? new Set<string>() : null;

  for (let index = 0; index < length; index++) {
    const item = readOwnDataProperty(value as unknown[], index);
    if (typeof item !== "string" || !validate(item) || seen?.has(item)) return null;
    seen?.add(item);
    result.push(item);
  }

  return Object.freeze(result) as string[];
}
