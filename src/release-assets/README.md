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

- accepts only the exact v1 object shape;
- validates canonical identifiers, paths, timestamps, hashes, content types,
  sizes, route references, and collection limits;
- does not execute accessors or propagate validation exceptions;
- returns a detached, deeply frozen snapshot with null-prototype records; and
- returns `null` for any invalid body.

Producers validate their assembled manifest through the same parser before the
PUT request. Consumers must use a parsed manifest or another trusted
`ReleaseAssetManifest`; they must not cast arbitrary API JSON to that type.

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
- the final PUT does not acknowledge `ready` or `partial` for the expected
  manifest version.

Individual transform, dependency, or CSS coverage gaps may still produce a
valid partial-coverage manifest. Those gaps are bounded diagnostics, and
uncovered entries remain on the established JIT path.

### JIT fallback is not an authorization fallback

When manifest consumption is disabled, unavailable, timed out, not ready, or
invalid, readers return `null`. Callers then use the existing release-scoped JIT
module path. This availability fallback does not bypass authentication,
project scoping, or release scoping.

Manifest fetchers are registered per release ID. Cache entries and in-flight
requests are tied to the current fetcher owner, use collision-free tuple keys,
time out after 10 seconds, and are aborted when ownership or cache generation
changes. The global fallback fetcher exists for simple single-project and test
setups; hosted runtimes should register a release-scoped fetcher.

## Feature flags

Both flags are host deployment settings and default to off.

| Constant                                       | Environment variable                            | Effect                                                                       |
| ---------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| `RELEASE_ASSET_MANIFEST_ENV_FLAG`              | `VERYFRONT_RELEASE_ASSET_MANIFEST`              | Enables manifest reads for production HTML, hydration, and cache versioning. |
| `RELEASE_ASSET_DEPENDENCY_IMPORT_MAP_ENV_FLAG` | `VERYFRONT_RELEASE_ASSET_DEPENDENCY_IMPORT_MAP` | Enables dependency vendoring and immutable dependency rewrites.              |

Dependency rewrites require an available manifest body. A missing dependency
entry preserves the source/JIT URL and prevents an unsafe immutable module
response cache entry.

## Manifest limits

`RELEASE_ASSET_MANIFEST_LIMITS` is the single producer-and-consumer source for
these v1 bounds.

| Field                     |            Limit |
| ------------------------- | ---------------: |
| Identifier length         |   256 characters |
| Builder version length    |   128 characters |
| Manifest key length       | 2,048 characters |
| Style profile hash length |   256 characters |
| Diagnostic gap length     | 4,096 characters |
| Module entries            |           20,000 |
| Dependency entries        |           10,000 |
| Dependency specifiers     |           40,000 |
| CSS entries               |              512 |
| Route entries             |           20,000 |
| Modules per route         |           20,000 |
| CSS hashes per route      |              512 |
| Fallback gaps             |           20,000 |
| Total route references    |          200,000 |
| Bytes per asset           |           10 MiB |

The build executor also caps the release file list, total source bytes, pending
asset bytes, dependency traversal depth, CSS candidates, and upload
concurrency. Exceeding a structural build boundary produces an explicit failed
build rather than silent truncation. Diagnostic overflow is represented by a
stable bounded marker so diagnostics cannot invalidate an otherwise valid
manifest.

## Public API

Import the supported surface from `veryfront/release-assets`.

| Area        | Main exports                                                                               |
| ----------- | ------------------------------------------------------------------------------------------ |
| Schema      | `getReleaseAssetManifestSchema`, `parseReleaseAssetManifest`, manifest and entry types     |
| Build       | `runReleaseAssetBuild`, build client/input/result, transform and dependency-vendor types   |
| Cache       | release-scoped fetcher registration, sync and async ready-manifest readers, cache clearing |
| Consumption | module URL normalization and manifest route preload resolution                             |
| CSS         | `createCompileProjectCss` and its option/result types                                      |
| Constants   | schema version, limits, paths, flags, content types, size and version-query constants      |

The synchronous reader is non-blocking: a cold miss schedules a fetch and
returns `null`. Use `getReadyManifestForRenderAsync()` when one render must use a
single manifest snapshot across import maps, preload hints, CSS, and hydration.

## Internal map

| File                    | Responsibility                                                    |
| ----------------------- | ----------------------------------------------------------------- |
| `manifest-schema.ts`    | v1 schema, dependency-free parser, immutable snapshot             |
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
