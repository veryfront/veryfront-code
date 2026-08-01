---
title: "veryfront/release-assets"
description: "Release Asset Manifest - public barrel."
order: 25
---

## Import

```ts
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  contentTypeForExtension,
  createCompileProjectCss,
  getReadyManifestForRender,
  isAllowedReleaseAssetContentType,
} from "veryfront/release-assets";
```

## Examples

### Build an immutable URL for a published JavaScript asset

```ts
import { releaseAssetUrl } from "veryfront/release-assets";

const url = releaseAssetUrl("a".repeat(64), "js");
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `RELEASE_ASSET_BASE_PATH` | Public asset base path served on the project's own domain (proxy-owned). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L11) |
| `RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST` | Allowlist of accepted content types (upstream + upload validation). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L23) |
| `RELEASE_ASSET_CONTENT_TYPES` | Content types permitted for release assets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L14) |
| `RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS` | Immutable cache max-age in seconds (1 year). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L32) |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG` | Env flag that enables HTML manifest consumption in production (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L44) |
| `RELEASE_ASSET_MANIFEST_SCHEMA_VERSION` | Current manifest body schema version. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L8) |
| `RELEASE_ASSET_MAX_SIZE_BYTES` | Maximum size (bytes) for a single uploaded asset (10 MB). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L29) |
| `RELEASE_ASSET_UPLOAD_CONCURRENCY` | Bounded upload concurrency when posting assets during a build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L41) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `clearReleaseAssetManifestCache` | Clear the cache and fetcher registry (tests / adapter teardown). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L369) |
| `configureReleaseAssetManifestFetcher` | Register a single global fetcher (for tests / simple single-project setups). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L121) |
| `contentTypeForExtension` | Resolve the content type for an extension, or null if not allowed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L59) |
| `createCompileProjectCss` | Build a `compileProjectCss` function bound to a specific release build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L59) |
| `getReadyManifestForRender` | Return a ready manifest for `releaseId` if one is cached, else null. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L184) |
| `isAllowedReleaseAssetContentType` | True when the value is a valid allowlisted release asset content type. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L68) |
| `isReleaseAssetManifestEnabled` | True when production manifest consumption is enabled via env flag. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L139) |
| `isValidContentHash` | Validate a content hash is exactly 64 lowercase hex characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L77) |
| `normalizeManifestModuleKey` | Normalize a logical module path to the manifest's key convention. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L27) |
| `parseReleaseAssetManifest` | Hand-rolled structural validator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L106) |
| `registerManifestFetcherForRelease` | Register a project-scoped manifest fetcher for the given releaseId. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L99) |
| `releaseAssetUrl` | Map a 64-hex content hash + extension to its public asset URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L54) |
| `resolveManifestModuleUrl` | Resolve a module URL through the manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L41) |
| `resolveManifestRoutePreloadUrls` | Resolve the route closure module URLs for preload hints from the manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L61) |
| `routeForPage` | Derive a route path from a page module logical path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/route-path.ts#L47) |
| `runReleaseAssetBuild` | Execute a release asset build. Pure orchestration over the injected client and a runtime-provided temp dir + react version. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L1517) |
| `unregisterManifestFetcherForRelease` | Remove the manifest fetcher for the given releaseId. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L111) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CompileProjectCssOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L39) |
| `CompileProjectCssResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/css-compile.ts#L34) |
| `ReleaseAssetBuildClient` | Subset of the API client used by the builder (eases testing). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L183) |
| `ReleaseAssetBuildInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L103) |
| `ReleaseAssetBuildResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L220) |
| `ReleaseAssetContentType` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L20) |
| `ReleaseAssetCssEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L80) |
| `ReleaseAssetEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L79) |
| `ReleaseAssetExtension` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L19) |
| `ReleaseAssetManifest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L76) |
| `ReleaseAssetManifestFetcher` | Fetcher used to retrieve a manifest for a release. Registered per-releaseId by the runtime adapter that owns that release, so the correct project-scoped token is always used. Returns null when the manifest is unavailable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L83) |
| `ReleaseAssetManifestResponse` | Response shape for the GET asset-manifest endpoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L93) |
| `ReleaseAssetManifestState` | Manifest lifecycle states (DB-owned; mirrored here for runtime checks). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L84) |
| `ReleaseAssetRouteEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L81) |
| `ReleaseAssetTransform` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/build-executor.ts#L140) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `getReleaseAssetManifestSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L50) |
