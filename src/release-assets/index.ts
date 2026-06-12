/**
 * Release Asset Manifest — public barrel.
 *
 * @module release-assets
 */

export {
  contentTypeForExtension,
  isAllowedReleaseAssetContentType,
  isValidContentHash,
  RELEASE_ASSET_BASE_PATH,
  RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST,
  RELEASE_ASSET_CONTENT_TYPES,
  type ReleaseAssetContentType,
  type ReleaseAssetExtension,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  releaseAssetUrl,
} from "./constants.ts";
export { sha256Hex, sha256HexBytes } from "./hash.ts";
export {
  getReleaseAssetManifestSchema,
  parseReleaseAssetManifest,
  type ReleaseAssetCssEntry,
  type ReleaseAssetEntry,
  type ReleaseAssetManifest,
  type ReleaseAssetManifestResponse,
  type ReleaseAssetManifestState,
  type ReleaseAssetRouteEntry,
} from "./manifest-schema.ts";
export {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRender,
  isReleaseAssetManifestEnabled,
  registerManifestFetcherForRelease,
  type ReleaseAssetManifestFetcher,
  unregisterManifestFetcherForRelease,
} from "./manifest-cache.ts";
export {
  normalizeManifestModuleKey,
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "./html-consumption.ts";
export {
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
  type ReleaseAssetBuildResult,
  type ReleaseAssetTransform,
  runReleaseAssetBuild,
} from "./build-executor.ts";
