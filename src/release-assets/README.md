# Release asset manifest reference

The release-assets module turns an immutable release file set into
content-addressed JavaScript and CSS assets plus a versioned manifest. Production
HTML, hydration, module serving, rendering caches, and the asset proxy consume
that manifest without changing the existing JIT authorization boundary.

```text
release files -> build + upload -> validated manifest -> HTML/module consumers
```

## Core contracts

### Manifest trust boundary

Treat every manifest body as untrusted input. `parseReleaseAssetManifest()`:

- accepts only the exact v2 object shape;
- validates canonical identifiers, paths, timestamps, hashes, content types,
  sizes, route references, and collection limits;
- does not execute accessors or propagate validation exceptions;
- returns a detached, deeply frozen snapshot with null-prototype records; and
- returns `null` for any invalid body.

Producers validate their assembled manifest through the same parser before the
PUT request. Consumers must use a parsed manifest or another trusted
`ReleaseAssetManifest`; they must not cast arbitrary API JSON to that type.

Manifest v2 makes every CSS entry provenance-complete: `styleProfileHash` is a
required lowercase SHA-256 digest and `cssPipelineIdentity` is the exact bounded
compiler/optimizer identity captured for that compilation. V1 manifests are
rejected rather than upgraded because those identities cannot be reconstructed
reliably from legacy output.

Every v2 manifest also declares `dependencyMode`. `"source"` means the built
module closure may retain HTTP imports, so its dependency map is not an
authoritative immutable closure and is never eligible for URL substitution.
`"immutable"` means every dependency entry names an uploaded,
content-addressed asset and the published module closure contains no source HTTP
imports. HTML import maps and module rewrites consume only immutable dependency
entries; fragment variants remain distinct and keep their original fragment on
the rewritten asset URL.

### Content identity

An uploaded asset is identified by both its lowercase SHA-256 hash and its
allowlisted content type. JavaScript and CSS with equal bytes are separate
content identities and are each acknowledged independently. Public URLs use:

```text
/_vf/assets/{64-lowercase-hex}.{js|css}
```

`releaseAssetUrl()` rejects malformed hashes and unsupported extensions.

### Build acknowledgement

`runReleaseAssetBuild()` fails closed when:

- the build-start response is malformed or carries an unsafe manifest version;
- release paths, source sizes, graph sizes, or dependency identities violate a
  declared boundary;
- an upload is not acknowledged as stored or already present; or
- the final PUT does not acknowledge `ready` for the expected manifest version.

Transform, dependency, route-closure, and CSS coverage failures are bounded
diagnostics, but they never produce a manifest. The executor proves complete
coverage before its first upload, then accepts only a `ready` acknowledgement
for the exact manifest version. This prevents an incomplete build from leaving
unreferenced immutable assets or silently delegating selected entries to JIT.

### JIT fallback is not an authorization fallback

When manifest consumption is disabled, unavailable, timed out, not ready, or
invalid, readers return `null`. Callers then use the existing release-scoped JIT
module path. This availability fallback does not bypass authentication,
project scoping, or release scoping.

`deploy` follows the same rule for one specific rejection. When a ready body
declares a schema version other than the one this build reads, the assets were
produced by a different framework version and neither side can act on the
other's body. `readMismatchedReleaseAssetManifestSchemaVersion()` identifies
that case, and the deploy proceeds with a warning instead of failing, because
the operator cannot change the builder from the deploying machine. Every other
rejection stays fatal: only a declared schema version separates a version skew
from a corrupt or tampered body.

Manifest fetchers are registered per release ID. Cache entries and in-flight
requests are tied to the current fetcher owner, use collision-free tuple keys,
time out after 10 seconds, and are aborted when ownership or cache generation
changes. A release without its own registered fetcher returns `null` and uses
the existing release-scoped JIT path.

## Feature flags

Both flags are host deployment settings and default to off.

| Constant                                       | Environment variable                            | Effect                                                                             |
| ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG`              | `VERYFRONT_RELEASE_ASSET_MANIFEST`              | Enables manifest reads for production HTML, hydration, and cache versioning.       |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | `VERYFRONT_RELEASE_ASSET_DEPENDENCY_IMPORT_MAP` | Enables immutable dependency consumption and requests local dependency generation. |

Dependency rewrites require an available manifest body with
`dependencyMode: "immutable"`. Source-mode or missing dependency entries preserve
the verified source/JIT URL and prevent an unsafe immutable module response
cache entry.

The dependency flag is a consumer and local-build setting; it does not select a
hosted build mode. Hosted builders pass `dependencyMode` explicitly. Source mode
forbids a vendor argument. Immutable mode requires an explicitly composed,
policy-enforced `ReleaseAssetHttpDependencyVendor` implementation before the
build begins. That implementation belongs in an extension; the framework does
not silently select the legacy HTTP cache because it is not an adequate
network-policy boundary.

## Manifest limits

`RELEASE_ASSET_MANIFEST_LIMITS` is the single producer-and-consumer source for
these v2 bounds.

| Field                     |            Limit |
| ------------------------- | ---------------: |
| Identifier length         |   256 characters |
| Builder version length    |   128 characters |
| Manifest key length       | 2,048 characters |
| Style profile hash length |    64 characters |
| CSS pipeline identity     | 2,048 characters |
| Coverage failure length   | 4,096 characters |
| Module entries            |           20,000 |
| Dependency entries        |           10,000 |
| Dependency specifiers     |           40,000 |
| CSS entries               |                1 |
| Route entries             |           20,000 |
| Modules per route         |           20,000 |
| CSS hashes per route      |                1 |
| Coverage failures         |           20,000 |
| Total route references    |          200,000 |
| Bytes per asset           |           10 MiB |
| Pending asset bytes       |          256 MiB |

The build executor also caps the release file list, total source bytes, pending
asset bytes, dependency traversal depth, CSS candidates, and upload
concurrency. Exceeding a structural build boundary produces an explicit failed
build rather than silent truncation. Diagnostic overflow uses a stable bounded
marker so failed-build diagnostics remain deterministic without unbounded
memory or error payloads.

## Public API

Import the supported surface from `veryfront/release-assets`.

| Area        | Main exports                                                                               |
| ----------- | ------------------------------------------------------------------------------------------ |
| Schema      | strict manifest/ready-envelope parsers, immutable capability guard, and manifest types     |
| Cache       | release-scoped fetcher registration, sync and async ready-manifest readers, cache clearing |
| Consumption | module URL normalization and manifest route preload resolution                             |
| Constants   | schema version, limits, paths, flags, content types, size and version-query constants      |

The hosted build executor and CSS compiler are internal composition surfaces,
not exports of `veryfront/release-assets`. Runtime code imports their exact
internal modules and supplies required extension capabilities explicitly. This
keeps the public release-assets dependency graph free of third-party packages.

The synchronous reader is non-blocking: a cold miss schedules a fetch and
returns `null`. Use `getReadyManifestForRenderAsync()` when one render must use a
single manifest snapshot across import maps, preload hints, CSS, and hydration.

## Internal map

| File                    | Responsibility                                                    |
| ----------------------- | ----------------------------------------------------------------- |
| `manifest-schema.ts`    | v2 schema, dependency-free parser, immutable snapshot             |
| `manifest-cache.ts`     | release/owner-scoped cache, in-flight deduplication, cancellation |
| `build-executor.ts`     | release materialization, transform graph, uploads, manifest PUT   |
| `css-compile.ts`        | bounded production CSS compilation                                |
| `html-consumption.ts`   | hashed module and route preload resolution                        |
| `module-consumption.ts` | cache-root-authorized, size-bounded dependency import rewrites    |
| `client-module-map.ts`  | safe hydration module map construction                            |
| `constants.ts`          | shared identity, flag, content, and limit contracts               |

## Verification

Run the module checks with:

```sh
deno fmt --check src/release-assets
deno lint src/release-assets
deno check src/release-assets/*.ts
deno test -A src/release-assets
```

Changes to manifest semantics also require the direct consumer suites under
`src/build`, `src/cache`, `src/html`, `src/modules/server`, `src/platform`,
`src/proxy`, `src/rendering`, and `src/server`.
