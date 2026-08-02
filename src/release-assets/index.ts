/**
 * Release Asset Manifest — public barrel.
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
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  type ReleaseAssetContentType,
  type ReleaseAssetExtension,
  releaseAssetUrl,
} from "./constants.ts";
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
export {
  type CompileProjectCssOptions,
  type CompileProjectCssResult,
  createCompileProjectCss,
} from "./css-compile.ts";
export { routeForPage } from "./route-path.ts";
