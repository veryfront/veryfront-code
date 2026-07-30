/**
 * Release Asset Manifest — shared constants.
 *
 * @module release-assets/constants
 */

/** Current manifest body schema version. */
export const RELEASE_ASSET_MANIFEST_SCHEMA_VERSION = 2 as const;

/** Public asset base path served on the project's own domain (proxy-owned). */
export const RELEASE_ASSET_BASE_PATH = "/_vf/assets" as const;

/** Content types permitted for release assets. */
export const RELEASE_ASSET_CONTENT_TYPES = Object.freeze(
  {
    js: "text/javascript",
    css: "text/css",
  } as const,
);

/** File extensions supported by the immutable release asset endpoint. */
export type ReleaseAssetExtension = keyof typeof RELEASE_ASSET_CONTENT_TYPES;
/** MIME types accepted for immutable release asset uploads and responses. */
export type ReleaseAssetContentType = (typeof RELEASE_ASSET_CONTENT_TYPES)[ReleaseAssetExtension];

/** Allowlist of accepted content types (upstream + upload validation). */
export const RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST: readonly ReleaseAssetContentType[] = Object
  .freeze([
    RELEASE_ASSET_CONTENT_TYPES.js,
    RELEASE_ASSET_CONTENT_TYPES.css,
  ]);

/** Maximum size (bytes) for a single uploaded asset (10 MB). */
export const RELEASE_ASSET_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum aggregate bytes retained while preparing one asset generation. */
export const RELEASE_ASSET_MAX_PENDING_BYTES = 256 * 1024 * 1024;

/** Work and memory bounds enforced by every manifest producer and consumer. */
export const RELEASE_ASSET_MANIFEST_LIMITS = Object.freeze(
  {
    identifierLength: 256,
    builderVersionLength: 128,
    manifestKeyLength: 2_048,
    styleProfileHashLength: 64,
    cssPipelineIdentityLength: 2_048,
    coverageFailureLength: 4_096,
    moduleEntries: 20_000,
    dependencyEntries: 10_000,
    dependencySpecifiers: 40_000,
    // v2 publishes one release-global stylesheet. Consumers intentionally use
    // that single immutable asset rather than selecting per-route variants.
    cssEntries: 1,
    routeEntries: 20_000,
    routeModules: 20_000,
    routeCssEntries: 1,
    coverageFailures: 20_000,
    totalRouteReferences: 200_000,
  } as const,
);

/** Immutable cache max-age in seconds (1 year). */
export const RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;

/** Query param that scopes fallback module URLs to an immutable release. */
export const RELEASE_MODULE_VERSION_PARAM = "vf_release" as const;

/** Query param that scopes fallback module URLs to the Veryfront runtime build. */
export const RELEASE_MODULE_RUNTIME_VERSION_PARAM = "vf_runtime" as const;

/** Bounded upload concurrency when posting assets during a build. */
export const RELEASE_ASSET_UPLOAD_CONCURRENCY = 8;

/** Env flag that enables HTML manifest consumption in production (default OFF). */
export const RELEASE_ASSET_MANIFEST_ENV_FLAG = "VERYFRONT_RELEASE_ASSET_MANIFEST";

/** Env flag that enables manifest dependency import-map rewrites (default OFF). */
export const RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG =
  "VERYFRONT_RELEASE_ASSET_DEPENDENCY_IMPORT_MAP";

/** Map a 64-hex content hash + extension to its public asset URL. */
export function releaseAssetUrl(contentHash: string, extension: ReleaseAssetExtension): string {
  if (!isValidContentHash(contentHash)) {
    throw new TypeError("Release asset content hash must be 64 lowercase hexadecimal characters");
  }
  if (!contentTypeForExtension(extension)) {
    throw new TypeError(`Unsupported release asset extension: ${String(extension)}`);
  }
  return `${RELEASE_ASSET_BASE_PATH}/${contentHash}.${extension}`;
}

/** Resolve the content type for an extension, or null if not allowed. */
export function contentTypeForExtension(
  extension: string,
): ReleaseAssetContentType | null {
  if (extension === "js") return RELEASE_ASSET_CONTENT_TYPES.js;
  if (extension === "css") return RELEASE_ASSET_CONTENT_TYPES.css;
  return null;
}

/** True when the value is a valid allowlisted release asset content type. */
export function isAllowedReleaseAssetContentType(
  value: string | null | undefined,
): value is ReleaseAssetContentType {
  if (!value) return false;
  const base = value.split(";")[0]?.trim();
  return RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST.some((allowed) => allowed === base);
}

/** Validate a content hash is exactly 64 lowercase hex characters. */
export function isValidContentHash(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}
