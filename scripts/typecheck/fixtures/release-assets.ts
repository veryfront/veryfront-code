import {
  getReadyManifestForRenderAsync,
  parseReleaseAssetManifest,
  registerManifestFetcherForRelease,
  RELEASE_ASSET_MANIFEST_LIMITS,
  type ReleaseAssetManifestFetcher,
  releaseAssetUrl,
  type ReleaseAssetVendorResult,
} from "veryfront/release-assets";

const assetUrl: string = releaseAssetUrl("a".repeat(64), "js");
const dependencyLimit: number = RELEASE_ASSET_MANIFEST_LIMITS.dependencyEntries;

const fetcher: ReleaseAssetManifestFetcher = (_releaseId, context) => {
  void context.signal.aborted;
  return Promise.resolve(null);
};

const unregister = registerManifestFetcherForRelease("release-1", fetcher);
const manifest = parseReleaseAssetManifest({});
void getReadyManifestForRenderAsync("release-1", { refreshCachedNull: true });
void assetUrl;
void dependencyLimit;
void manifest;
unregister();

const vendorResult = {
  code: "export default 1;",
  dependencies: [{
    specifier: "https://cdn.example/dependency.js",
    manifestKey: "https://cdn.example/dependency.js",
    code: "export default 1;",
  }],
} satisfies ReleaseAssetVendorResult;
void vendorResult;

// @ts-expect-error Release asset extensions are restricted to the public allowlist.
releaseAssetUrl("a".repeat(64), "json");
