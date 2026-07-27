---
title: "veryfront/release-assets"
description: "Content-addressed release asset build, schema, cache, and consumption contracts."
order: 24
---

## Import

```ts
import {
  parseReleaseAssetManifest,
  runReleaseAssetBuild,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
  releaseAssetUrl,
  clearCachedReleaseAssetManifests,
} from "veryfront/release-assets";
```

## Examples

### Validate an API response before consuming its manifest body.

```ts
import { parseReleaseAssetManifest } from "veryfront/release-assets";

const response = await fetch("/api/releases/current/asset-manifest");
const manifest = parseReleaseAssetManifest(await response.json());
if (!manifest) throw new Error("Invalid release asset manifest");
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `RELEASE_ASSET_BASE_PATH` | Public asset base path served on the project's own domain (proxy-owned). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L11) |
| `RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST` | Allowlist of accepted content types (upstream + upload validation). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L27) |
| `RELEASE_ASSET_CONTENT_TYPES` | Content types permitted for release assets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L14) |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | Env flag that enables manifest dependency import-map rewrites (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L72) |
| `RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS` | Immutable cache max-age in seconds (1 year). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L57) |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG` | Env flag that enables HTML manifest consumption in production (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L69) |
| `RELEASE_ASSET_MANIFEST_LIMITS` | Work and memory bounds enforced by every manifest producer and consumer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L37) |
| `RELEASE_ASSET_MANIFEST_SCHEMA_VERSION` | Current manifest body schema version. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L8) |
| `RELEASE_ASSET_MAX_SIZE_BYTES` | Maximum size (bytes) for a single uploaded asset (10 MB). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L34) |
| `RELEASE_ASSET_UPLOAD_CONCURRENCY` | Bounded upload concurrency when posting assets during a build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L66) |
| `RELEASE_MODULE_RUNTIME_VERSION_PARAM` | Query param that scopes fallback module URLs to the Veryfront runtime build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L63) |
| `RELEASE_MODULE_VERSION_PARAM` | Query param that scopes fallback module URLs to an immutable release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L60) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearCachedReleaseAssetManifests` | Clear cached manifest bodies while keeping registered fetchers intact. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L536) |
| `clearReleaseAssetManifestCache` | Clear the cache and fetcher registry (tests / adapter teardown). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L546) |
| `configureReleaseAssetManifestFetcher` | Register a single global fetcher (for tests / simple single-project setups). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L201) |
| `contentTypeForExtension` | Resolve the content type for an extension, or null if not allowed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L87) |
| `createCompileProjectCss` | Build a `compileProjectCss` function bound to a specific release build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L69) |
| `getReadyManifestForRender` | Return a ready manifest for `releaseId` if one is cached, else null. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L268) |
| `getReadyManifestForRenderAsync` | Await a ready manifest for `releaseId`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L321) |
| `isAllowedReleaseAssetContentType` | True when the value is a valid allowlisted release asset content type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L96) |
| `isReleaseAssetManifestEnabled` | True when production manifest consumption is enabled via env flag. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L223) |
| `isValidContentHash` | Validate a content hash is exactly 64 lowercase hex characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L105) |
| `normalizeManifestModuleKey` | Normalize a logical module path to the manifest's key convention. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L27) |
| `parseReleaseAssetManifest` | Parse an untrusted manifest without requiring a registered schema extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L299) |
| `registerManifestFetcherForRelease` | Register a project-scoped manifest fetcher for the given releaseId. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L152) |
| `releaseAssetUrl` | Map a 64-hex content hash + extension to its public asset URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L76) |
| `resolveManifestModuleUrl` | Resolve a module URL through the manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L42) |
| `resolveManifestRoutePreloadUrls` | Resolve the route closure module URLs for preload hints from the manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L64) |
| `runReleaseAssetBuild` | Execute a release asset build. Pure orchestration over the injected client and a runtime-provided temp dir + react version. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L2054) |
| `unregisterManifestFetcherForRelease` | Remove the manifest fetcher for the given releaseId. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L190) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CompileProjectCssOptions` | Configuration captured by a release-scoped CSS compiler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L47) |
| `CompileProjectCssResult` | Successful bounded CSS compilation output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L41) |
| `CompileProjectCssRuntimeOptions` | Per-build configuration resolved from the materialized release. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L55) |
| `PreparedReleaseAsset` | Prepared content-addressed asset bytes ready for upload. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L251) |
| `ReadyManifestReadOptions` | Controls revalidation behavior for awaited manifest reads. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L73) |
| `ReleaseAssetBuildClient` | Subset of the API client used by the builder (eases testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L195) |
| `ReleaseAssetBuildInput` | Inputs required to build and publish one release asset manifest generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L122) |
| `ReleaseAssetBuildResult` | Observable outcome of a release asset build attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L233) |
| `ReleaseAssetContentType` | MIME types accepted for immutable release asset uploads and responses. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L24) |
| `ReleaseAssetCssEntry` | Content-addressed CSS entry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L269) |
| `ReleaseAssetEntry` | Content-addressed JavaScript module entry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L267) |
| `ReleaseAssetExtension` | File extensions supported by the immutable release asset endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L22) |
| `ReleaseAssetHttpDependencyVendor` | Injectable HTTP dependency vendoring contract. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L186) |
| `ReleaseAssetManifest` | Validated, immutable release asset manifest v1 body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L263) |
| `ReleaseAssetManifestFetchContext` | Cancellation context passed to a release-scoped manifest fetcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L88) |
| `ReleaseAssetManifestFetcher` | Fetcher used to retrieve a manifest for a release. Registered per-releaseId by the runtime adapter that owns that release, so the correct project-scoped token is always used. Returns null when the manifest is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L98) |
| `ReleaseAssetManifestFetcherCleanup` | Idempotent cleanup for one fetcher registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L108) |
| `ReleaseAssetManifestResponse` | Response shape for the GET asset-manifest endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L283) |
| `ReleaseAssetManifestState` | Manifest lifecycle states (DB-owned; mirrored here for runtime checks). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L274) |
| `ReleaseAssetRouteEntry` | Per-route module and CSS closure. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L271) |
| `ReleaseAssetTransform` | Browser transform contract shared with the module-serving pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L159) |
| `ReleaseAssetVendorDependency` | One vendored dependency and the source identity represented by its code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L168) |
| `ReleaseAssetVendorResult` | Rewritten module code plus every dependency needed by that rewrite. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L180) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getReleaseAssetManifestSchema` | Extension-backed validator for the strict release asset manifest v1 body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L208) |
