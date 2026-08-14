/**
 * Content-addressed release asset build, schema, cache, and consumption
 * contracts.
 *
 * @example Validate an API response before consuming its manifest body.
 * ```ts
 * import { parseReadyReleaseAssetManifestResponse } from "veryfront/release-assets";
 *
 * const expectedReleaseId = "release-123";
 * const response = await fetch("/api/releases/current/asset-manifest");
 * const ready = parseReadyReleaseAssetManifestResponse(
 *   await response.json(),
 *   expectedReleaseId,
 * );
 * if (!ready) throw new Error("Invalid release asset manifest response");
 * const manifest = ready.manifest;
 * ```
 *
 * @module release-assets
 * @example Build an immutable URL for a published JavaScript asset
 * ```ts
 * import { releaseAssetUrl } from "veryfront/release-assets";
 *
 * const url = releaseAssetUrl("a".repeat(64), "js");
 * ```
 */

export {
  contentTypeForExtension,
  isAllowedReleaseAssetContentType,
  isValidContentHash,
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_PENDING_BYTES,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
  type ReleaseAssetContentType,
  type ReleaseAssetExtension,
  releaseAssetUrl,
} from "./constants.ts";
export {
  describeReadyReleaseAssetManifestRejection,
  getReleaseAssetManifestSchema,
  hasImmutableReleaseAssetDependencies,
  type ImmutableReleaseAssetManifest,
  isSafeBoundedText,
  parseReadyReleaseAssetManifestResponse,
  parseReleaseAssetManifest,
  readUntrustedOwnDataProperty,
  type ReadyReleaseAssetManifestResponse,
  type ReleaseAssetCssEntry,
  type ReleaseAssetDependencyMode,
  type ReleaseAssetEntry,
  type ReleaseAssetManifest,
  type ReleaseAssetManifestParseOptions,
  type ReleaseAssetManifestResponse,
  type ReleaseAssetManifestState,
  type ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";
export {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
  isReleaseAssetManifestEnabled,
  type ReadyManifestReadOptions,
  registerManifestFetcherForRelease,
  type ReleaseAssetManifestFetchContext,
  type ReleaseAssetManifestFetcher,
  type ReleaseAssetManifestFetcherCleanup,
  unregisterManifestFetcherForRelease,
} from "./manifest-cache.ts";
export {
  normalizeManifestModuleKey,
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "./html-consumption.ts";
export { routeForPage } from "./route-path.ts";
