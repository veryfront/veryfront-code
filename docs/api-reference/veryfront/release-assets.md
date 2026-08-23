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
| `RELEASE_ASSET_BASE_PATH`                      | Public asset base path served on the project's own domain (proxy-owned).     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L10) |
| `RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST`         | Allowlist of accepted content types (upstream + upload validation).          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L26) |
| `RELEASE_ASSET_CONTENT_TYPES`                  | Content types permitted for release assets.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L13) |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | Env flag that enables manifest dependency import-map rewrites (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L77) |
| `RELEASE_ASSET_IMMUTABLE_MAX_AGE_SECONDS`      | Immutable cache max-age in seconds (1 year).                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L62) |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG`              | Env flag that enables HTML manifest consumption in production (default OFF). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L74) |
| `RELEASE_ASSET_MANIFEST_LIMITS`                | Work and memory bounds enforced by every manifest producer and consumer.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L39) |
| `RELEASE_ASSET_MANIFEST_SCHEMA_VERSION`        | Current manifest body schema version.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L7)  |
| `RELEASE_ASSET_MAX_PENDING_BYTES`              | Maximum aggregate bytes retained while preparing one asset generation.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L36) |
| `RELEASE_ASSET_MAX_SIZE_BYTES`                 | Maximum size (bytes) for a single uploaded asset (10 MB).                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L33) |
| `RELEASE_ASSET_UPLOAD_CONCURRENCY`             | Bounded upload concurrency when posting assets during a build.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L71) |
| `RELEASE_MODULE_RUNTIME_VERSION_PARAM`         | Query param that scopes fallback module URLs to the Veryfront runtime build. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L68) |
| `RELEASE_MODULE_VERSION_PARAM`                 | Query param that scopes fallback module URLs to an immutable release.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L65) |

### Functions

| Name                                         | Description                                                                                                          | Source                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `clearCachedReleaseAssetManifests`           | Clear cached manifest bodies while keeping registered fetchers intact.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L594)  |
| `clearReleaseAssetManifestCache`             | Clear the cache and fetcher registry (tests / adapter teardown).                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L604)  |
| `contentTypeForExtension`                    | Resolve the content type for an extension, or null if not allowed.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L95)        |
| `describeReadyReleaseAssetManifestRejection` | Explain why a ready manifest response was rejected.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L428) |
| `getReadyManifestForRender`                  | Return a ready manifest for `releaseId` if one is cached, else null.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L258)  |
| `getReadyManifestForRenderAsync`             | Await a ready manifest for rendering when release-manifest consumption is enabled.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L359)  |
| `hasImmutableReleaseAssetDependencies`       | True only when manifest dependency entries are safe immutable rewrite targets.                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L304) |
| `isAllowedReleaseAssetContentType`           | True when the value is a valid allowlisted release asset content type.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L104)       |
| `isReleaseAssetManifestEnabled`              | True when production manifest consumption is enabled via env flag.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L203)  |
| `isSafeBoundedText`                          | Check that an untrusted value is a non-empty, trimmed string within `maxLength` that contains no control characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L101) |
| `isValidContentHash`                         | Validate a content hash is exactly 64 lowercase hex characters.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L113)       |
| `normalizeManifestModuleKey`                 | Normalize a logical module path to the manifest's key convention.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L26) |
| `parseReadyReleaseAssetManifestResponse`     | Parse an untrusted ready response without executing accessors.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L383) |
| `parseReleaseAssetManifest`                  | Parse an untrusted manifest without requiring a registered schema extension.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L365) |
| `readUntrustedOwnDataProperty`               | Read an own data property from an untrusted value without invoking accessors.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L483) |
| `registerManifestFetcherForRelease`          | Register a project-scoped manifest fetcher for the given releaseId.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L159)  |
| `releaseAssetUrl`                            | Map a 64-hex content hash + extension to its public asset URL.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L84)        |
| `resolveManifestModuleUrl`                   | Resolve a module URL through the manifest.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L41) |
| `resolveManifestRoutePreloadUrls`            | Resolve the route closure module URLs for preload hints from the manifest.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/html-consumption.ts#L63) |
| `routeForPage`                               | Derive a route path from a page module logical path.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/route-path.ts#L49)       |
| `unregisterManifestFetcherForRelease`        | Remove the manifest fetcher for the given releaseId.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L197)  |

### Types

| Name                                 | Description                                                                                                                                                                                                                            | Source                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `ImmutableReleaseAssetManifest`      | Manifest whose dependency entries name uploaded content-addressed assets.                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L299) |
| `ReadyManifestReadOptions`           | Controls revalidation behavior for awaited manifest reads.                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L77)   |
| `ReadyReleaseAssetManifestResponse`  | Strict ready response with a generation-matched validated manifest body.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L327) |
| `ReleaseAssetContentType`            | MIME types accepted for immutable release asset uploads and responses.                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L23)        |
| `ReleaseAssetCssEntry`               | Content-addressed CSS entry.                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L293) |
| `ReleaseAssetDependencyMode`         | Capability represented by entries in the manifest dependency map.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L297) |
| `ReleaseAssetEntry`                  | Content-addressed JavaScript module entry.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L291) |
| `ReleaseAssetExtension`              | File extensions supported by the immutable release asset endpoint.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/constants.ts#L21)        |
| `ReleaseAssetManifest`               | Validated, immutable release asset manifest v2 body.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L287) |
| `ReleaseAssetManifestFetchContext`   | Cancellation context passed to a release-scoped manifest fetcher.                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L92)   |
| `ReleaseAssetManifestFetcher`        | Fetcher used to retrieve a manifest for a release. Registered per-releaseId by the runtime adapter that owns that release, so the correct project-scoped token is always used. Returns null when the manifest is unavailable.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L109)  |
| `ReleaseAssetManifestFetcherCleanup` | Idempotent cleanup for one fetcher registration.                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-cache.ts#L117)  |
| `ReleaseAssetManifestParseOptions`   | Options shared by the dependency-free consumption parsers. `acceptLegacyV1` defaults to `false`, so a v1 manifest body is rejected as a schema skew; set it to `true` only on read paths that must still adapt a readable v1 manifest. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L342) |
| `ReleaseAssetManifestResponse`       | Response shape for the GET asset-manifest endpoint.                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L320) |
| `ReleaseAssetManifestState`          | Manifest lifecycle states (DB-owned; mirrored here for runtime checks).                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L311) |
| `ReleaseAssetRouteEntry`             | Per-route module and CSS closure.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L295) |

### Constants

| Name                            | Description                                                               | Source                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `getReleaseAssetManifestSchema` | Extension-backed validator for the strict release asset manifest v2 body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/release-assets/manifest-schema.ts#L237) |
