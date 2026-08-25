---
title: "veryfront/release-assets"
description: "Content-addressed release asset build, schema, cache, and consumption contracts."
order: 26
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

| Name                                           | Description                                                                  | Source                                                                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `RELEASE_ASSET_BASE_PATH`                      | Public asset base path served on the project's own domain (proxy-owned).     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L11) |
| `RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST`         | Allowlist of accepted content types (upstream + upload validation).          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L27) |
| `RELEASE_ASSET_CONTENT_TYPES`                  | Content types permitted for release assets.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L14) |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | Env flag that enables manifest dependency import-map rewrites (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L78) |
| `RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS`      | Immutable cache max-age in seconds (1 year).                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L63) |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG`              | Env flag that enables HTML manifest consumption in production (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L75) |
| `RELEASE_ASSET_MANIFEST_LIMITS`                | Work and memory bounds enforced by every manifest producer and consumer.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L40) |
| `RELEASE_ASSET_MANIFEST_SCHEMA_VERSION`        | Current manifest body schema version.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L8)  |
| `RELEASE_ASSET_MAX_PENDING_BYTES`              | Maximum aggregate bytes retained while preparing one asset generation.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L37) |
| `RELEASE_ASSET_MAX_SIZE_BYTES`                 | Maximum size (bytes) for a single uploaded asset (10 MB).                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L34) |
| `RELEASE_ASSET_UPLOAD_CONCURRENCY`             | Bounded upload concurrency when posting assets during a build.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L72) |
| `RELEASE_MODULE_RUNTIME_VERSION_PARAM`         | Query param that scopes fallback module URLs to the Veryfront runtime build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L69) |
| `RELEASE_MODULE_VERSION_PARAM`                 | Query param that scopes fallback module URLs to an immutable release.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L66) |

### Functions

| Name                                         | Description                                                                                                          | Source                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `clearCachedReleaseAssetManifests`           | Clear cached manifest bodies while keeping registered fetchers intact.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L595)  |
| `clearReleaseAssetManifestCache`             | Clear the cache and fetcher registry (tests / adapter teardown).                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L605)  |
| `contentTypeForExtension`                    | Resolve the content type for an extension, or null if not allowed.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L96)        |
| `describeReadyReleaseAssetManifestRejection` | Explain why a ready manifest response was rejected.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L429) |
| `getReadyManifestForRender`                  | Return a ready manifest for `releaseId` if one is cached, else null.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L259)  |
| `getReadyManifestForRenderAsync`             | Await a ready manifest for rendering when release-manifest consumption is enabled.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L360)  |
| `hasImmutableReleaseAssetDependencies`       | True only when manifest dependency entries are safe immutable rewrite targets.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L305) |
| `isAllowedReleaseAssetContentType`           | True when the value is a valid allowlisted release asset content type.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L105)       |
| `isReleaseAssetManifestEnabled`              | True when production manifest consumption is enabled via env flag.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L204)  |
| `isSafeBoundedText`                          | Check that an untrusted value is a non-empty, trimmed string within `maxLength` that contains no control characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L102) |
| `isValidContentHash`                         | Validate a content hash is exactly 64 lowercase hex characters.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L114)       |
| `normalizeManifestModuleKey`                 | Normalize a logical module path to the manifest's key convention.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L27) |
| `parseReadyReleaseAssetManifestResponse`     | Parse an untrusted ready response without executing accessors.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L384) |
| `parseReleaseAssetManifest`                  | Parse an untrusted manifest without requiring a registered schema extension.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L366) |
| `readUntrustedOwnDataProperty`               | Read an own data property from an untrusted value without invoking accessors.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L484) |
| `registerManifestFetcherForRelease`          | Register a project-scoped manifest fetcher for the given releaseId.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L160)  |
| `releaseAssetUrl`                            | Map a 64-hex content hash + extension to its public asset URL.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L85)        |
| `resolveManifestModuleUrl`                   | Resolve a module URL through the manifest.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L42) |
| `resolveManifestRoutePreloadUrls`            | Resolve the route closure module URLs for preload hints from the manifest.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L64) |
| `routeForPage`                               | Derive a route path from a page module logical path.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/route-path.ts#L50)       |
| `unregisterManifestFetcherForRelease`        | Remove the manifest fetcher for the given releaseId.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L198)  |

### Types

| Name                                 | Description                                                                                                                                                                                                                            | Source                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ImmutableReleaseAssetManifest`      | Manifest whose dependency entries name uploaded content-addressed assets.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L300) |
| `ReadyManifestReadOptions`           | Controls revalidation behavior for awaited manifest reads.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L78)   |
| `ReadyReleaseAssetManifestResponse`  | Strict ready response with a generation-matched validated manifest body.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L328) |
| `ReleaseAssetContentType`            | MIME types accepted for immutable release asset uploads and responses.                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L24)        |
| `ReleaseAssetCssEntry`               | Content-addressed CSS entry.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L294) |
| `ReleaseAssetDependencyMode`         | Capability represented by entries in the manifest dependency map.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L298) |
| `ReleaseAssetEntry`                  | Content-addressed JavaScript module entry.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L292) |
| `ReleaseAssetExtension`              | File extensions supported by the immutable release asset endpoint.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L22)        |
| `ReleaseAssetManifest`               | Validated, immutable release asset manifest v2 body.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L288) |
| `ReleaseAssetManifestFetchContext`   | Cancellation context passed to a release-scoped manifest fetcher.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L93)   |
| `ReleaseAssetManifestFetcher`        | Fetcher used to retrieve a manifest for a release. Registered per-release ID by the runtime adapter that owns that release, so the correct project-scoped token is always used. Returns null when the manifest is unavailable.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L110)  |
| `ReleaseAssetManifestFetcherCleanup` | Idempotent cleanup for one fetcher registration.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L118)  |
| `ReleaseAssetManifestParseOptions`   | Options shared by the dependency-free consumption parsers. `acceptLegacyV1` defaults to `false`, so a v1 manifest body is rejected as a schema skew; set it to `true` only on read paths that must still adapt a readable v1 manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L343) |
| `ReleaseAssetManifestResponse`       | Response shape for the GET asset-manifest endpoint.                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L321) |
| `ReleaseAssetManifestState`          | Manifest lifecycle states (DB-owned; mirrored here for runtime checks).                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L312) |
| `ReleaseAssetRouteEntry`             | Per-route module and CSS closure.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L296) |

### Constants

| Name                            | Description                                                               | Source                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `getReleaseAssetManifestSchema` | Extension-backed validator for the strict release asset manifest v2 body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L238) |
