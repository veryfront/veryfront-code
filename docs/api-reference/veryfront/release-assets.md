---
title: "veryfront/release-assets"
description: "Content-addressed release asset build, schema, cache, and consumption contracts."
order: 27
---

## Import

```ts
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  contentTypeForExtension,
  describeReadyReleaseAssetManifestRejection,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
} from "veryfront/release-assets";
```

## Examples

### Validate an API response before consuming its manifest body.

```ts
import { parseReadyReleaseAssetManifestResponse } from "veryfront/release-assets";

const expectedReleaseId = "release-123";
const response = await fetch("/api/releases/current/asset-manifest");
const ready = parseReadyReleaseAssetManifestResponse(
  await response.json(),
  expectedReleaseId,
);
if (!ready) throw new Error("Invalid release asset manifest response");
const manifest = ready.manifest;
```

### Build an immutable URL for a published JavaScript asset

```ts
import { releaseAssetUrl } from "veryfront/release-assets";

const url = releaseAssetUrl("a".repeat(64), "js");
```

## Exports

### Components

| Name                                           | Description                                                                  | Source                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `RELEASE_ASSET_BASE_PATH`                      | Public asset base path served on the project's own domain (proxy-owned).     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST`         | Allowlist of accepted content types (upstream + upload validation).          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_CONTENT_TYPES`                  | Content types permitted for release assets.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | Env flag that enables manifest dependency import-map rewrites (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS`      | Immutable cache max-age in seconds (1 year).                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG`              | Env flag that enables HTML manifest consumption in production (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_MANIFEST_LIMITS`                | Work and memory bounds enforced by every manifest producer and consumer.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_MANIFEST_SCHEMA_VERSION`        | Current manifest body schema version.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_MAX_PENDING_BYTES`              | Maximum aggregate bytes retained while preparing one asset generation.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_MAX_SIZE_BYTES`                 | Maximum size (bytes) for a single uploaded asset (10 MB).                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_ASSET_UPLOAD_CONCURRENCY`             | Bounded upload concurrency when posting assets during a build.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_MODULE_RUNTIME_VERSION_PARAM`         | Query param that scopes fallback module URLs to the Veryfront runtime build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |
| `RELEASE_MODULE_VERSION_PARAM`                 | Query param that scopes fallback module URLs to an immutable release.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts) |

### Functions

| Name                                         | Description                                                                                                          | Source                                                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `clearCachedReleaseAssetManifests`           | Clear cached manifest bodies while keeping registered fetchers intact.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `clearReleaseAssetManifestCache`             | Clear the cache and fetcher registry (tests / adapter teardown).                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `contentTypeForExtension`                    | Resolve the content type for an extension, or null if not allowed.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)        |
| `describeReadyReleaseAssetManifestRejection` | Explain why a ready manifest response was rejected.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `getReadyManifestForRender`                  | Return a ready manifest for `releaseId` if one is cached, else null.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `getReadyManifestForRenderAsync`             | Await a ready manifest for rendering when release-manifest consumption is enabled.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `hasImmutableReleaseAssetDependencies`       | True only when manifest dependency entries are safe immutable rewrite targets.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `isAllowedReleaseAssetContentType`           | True when the value is a valid allowlisted release asset content type.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)        |
| `isReleaseAssetManifestEnabled`              | True when production manifest consumption is enabled via env flag.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `isSafeBoundedText`                          | Check that an untrusted value is a non-empty, trimmed string within `maxLength` that contains no control characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `isValidContentHash`                         | Validate a content hash is exactly 64 lowercase hex characters.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)        |
| `normalizeManifestModuleKey`                 | Normalize a logical module path to the manifest's key convention.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts) |
| `parseReadyReleaseAssetManifestResponse`     | Parse an untrusted ready response without executing accessors.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `parseReleaseAssetManifest`                  | Parse an untrusted manifest without requiring a registered schema extension.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `readUntrustedOwnDataProperty`               | Read an own data property from an untrusted value without invoking accessors.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts)  |
| `registerManifestFetcherForRelease`          | Register a project-scoped manifest fetcher for the given releaseId.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |
| `releaseAssetUrl`                            | Map a 64-hex content hash + extension to its public asset URL.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)        |
| `resolveManifestModuleUrl`                   | Resolve a module URL through the manifest.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts) |
| `resolveManifestRoutePreloadUrls`            | Resolve the route closure module URLs for preload hints from the manifest.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts) |
| `routeForPage`                               | Derive a route path from a page module logical path.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/route-path.ts)       |
| `unregisterManifestFetcherForRelease`        | Remove the manifest fetcher for the given releaseId.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)   |

### Types

| Name                                 | Description                                                                                                                                                                                                                            | Source                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `ImmutableReleaseAssetManifest`      | Manifest whose dependency entries name uploaded content-addressed assets.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReadyManifestReadOptions`           | Controls revalidation behavior for awaited manifest reads.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)  |
| `ReadyReleaseAssetManifestResponse`  | Strict ready response with a generation-matched validated manifest body.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetContentType`            | MIME types accepted for immutable release asset uploads and responses.                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)       |
| `ReleaseAssetCssEntry`               | Content-addressed CSS entry.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetDependencyMode`         | Capability represented by entries in the manifest dependency map.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetEntry`                  | Content-addressed JavaScript module entry.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetExtension`              | File extensions supported by the immutable release asset endpoint.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts)       |
| `ReleaseAssetManifest`               | Validated, immutable release asset manifest v2 body.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetManifestFetchContext`   | Cancellation context passed to a release-scoped manifest fetcher.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)  |
| `ReleaseAssetManifestFetcher`        | Fetcher used to retrieve a manifest for a release. Registered per-release ID by the runtime adapter that owns that release, so the correct project-scoped token is always used. Returns null when the manifest is unavailable.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)  |
| `ReleaseAssetManifestFetcherCleanup` | Idempotent cleanup for one fetcher registration.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts)  |
| `ReleaseAssetManifestParseOptions`   | Options shared by the dependency-free consumption parsers. `acceptLegacyV1` defaults to `false`, so a v1 manifest body is rejected as a schema skew; set it to `true` only on read paths that must still adapt a readable v1 manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetManifestResponse`       | Response shape for the GET asset-manifest endpoint.                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetManifestState`          | Manifest lifecycle states (DB-owned; mirrored here for runtime checks).                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
| `ReleaseAssetRouteEntry`             | Per-route module and CSS closure.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |

### Constants

| Name                            | Description                                                               | Source                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `getReleaseAssetManifestSchema` | Extension-backed validator for the strict release asset manifest v2 body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts) |
