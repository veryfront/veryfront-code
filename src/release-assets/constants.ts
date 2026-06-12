/**
 * Release Asset Manifest — shared constants.
 *
 * @module release-assets/constants
 */

/** Current manifest body schema version. */
export const RELEASE_ASSET_MANIFEST_SCHEMA_VERSION = 1 as const;

/** Public asset base path served on the project's own domain (proxy-owned). */
export const RELEASE_ASSET_BASE_PATH = "/_vf/assets" as const;

/** Content types permitted for release assets. */
export const RELEASE_ASSET_CONTENT_TYPES = {
  js: "text/javascript",
  css: "text/css",
} as const;

export type ReleaseAssetExtension = keyof typeof RELEASE_ASSET_CONTENT_TYPES;
export type ReleaseAssetContentType = (typeof RELEASE_ASSET_CONTENT_TYPES)[ReleaseAssetExtension];

/** Allowlist of accepted content types (upstream + upload validation). */
export const RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST: readonly ReleaseAssetContentType[] = [
  RELEASE_ASSET_CONTENT_TYPES.js,
  RELEASE_ASSET_CONTENT_TYPES.css,
];

/** Maximum size (bytes) for a single uploaded asset (10 MB). */
export const RELEASE_ASSET_MAX_SIZE_BYTES = 10 * 1024 * 1024;

/** Immutable cache max-age in seconds (1 year). */
export const RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;

/** Bounded upload concurrency when posting assets during a build. */
export const RELEASE_ASSET_UPLOAD_CONCURRENCY = 8;

/** Env flag that enables HTML manifest consumption in production (default OFF). */
export const RELEASE_ASSET_MANIFEST_ENV_FLAG = "VERYFRONT_RELEASE_ASSET_MANIFEST";

/** Map a 64-hex content hash + extension to its public asset URL. */
export function releaseAssetUrl(contentHash: string, extension: ReleaseAssetExtension): string {
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
