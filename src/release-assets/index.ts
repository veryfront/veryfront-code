/**
 * Content-addressed release asset build, schema, cache, and consumption
 * contracts.
 *
 * @example Validate an API response before consuming its manifest body.
 * ```ts
 * import { parseReleaseAssetManifest } from "veryfront/release-assets";
 *
 * const response = await fetch("/api/releases/current/asset-manifest");
 * const manifest = parseReleaseAssetManifest(await response.json());
 * if (!manifest) throw new Error("Invalid release asset manifest");
 * ```
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
  RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG,
  RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  RELEASE_ASSET_MAX_SIZE_BYTES,
  RELEASE_ASSET_UPLOAD_CONCURRENCY,
  RELEASE_MODULE_RUNTIME_VERSION_PARAM,
  RELEASE_MODULE_VERSION_PARAM,
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
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
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
export {
  type PreparedReleaseAsset,
  type ReleaseAssetBuildClient,
  type ReleaseAssetBuildInput,
  type ReleaseAssetBuildResult,
  type ReleaseAssetHttpDependencyVendor,
  type ReleaseAssetTransform,
  type ReleaseAssetVendorDependency,
  type ReleaseAssetVendorResult,
  runReleaseAssetBuild,
} from "./build-executor.ts";
export {
  type CompileProjectCssOptions,
  type CompileProjectCssResult,
  type CompileProjectCssRuntimeOptions,
  createCompileProjectCss,
} from "./css-compile.ts";
