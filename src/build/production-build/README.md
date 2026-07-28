# Production build internals

This is a maintainer reference for `src/build/production-build/`. Application
authors should use `veryfront build` or `buildProduction()` from
`veryfront/build`; see the [Build module overview](../README.md).

The internal barrel in [`index.ts`](./index.ts) supports repository code and
tests. It is not a separate published package entry point.

## Orchestration

[`build/build-orchestrator.ts`](./build/build-orchestrator.ts) owns the
production transaction:

1. Normalize options. Verbose `enable*` fields take precedence over the
   `splitting`, `compress`, and `prefetch` shorthands.
2. Stat the project path and reject missing, inaccessible, or non-directory
   inputs with distinct errors.
3. Initialize the runtime adapter, configuration, renderer, and build stats.
4. Prove that the requested output does not replace or overlap the project,
   `public`, Pages, or App Router sources.
5. Collect routes, discover public assets, and preflight every portable output
   collision before writing.
6. Acquire the output lock and allocate a unique sibling staging directory.
7. Generate optional local dependency assets and split script-based Pages
   routes.
8. Render Pages and App Router routes.
9. Generate client runtimes, copy public assets, create the build manifest,
   service worker and redirects, then create compressed sidecars when enabled.
10. Reject an empty non-dry build.
11. Promote the complete staging directory and remove its backup.
12. Release publication resources, destroy the renderer, and clear transform
    caches.

Every cleanup stage is attempted. If a build and cleanup both fail, an
`AggregateError` preserves the build failure first. A successful publication
also reports cleanup failure if resources cannot ultimately be removed.

## Option normalization

The shared `BuildOptions` contract is defined in
[`server/build-types.ts`](../../server/build-types.ts).

| Normalized field     | Resolution                                                        |
| -------------------- | ----------------------------------------------------------------- |
| `outputDir`          | Explicit value, otherwise `<projectDir>/.veryfront/output`.       |
| `enableSplitting`    | `enableSplitting`, then `splitting`, then `true`.                 |
| `enableCompression`  | `enableCompression`, then `compress`, then `true`.                |
| `enablePrefetch`     | `enablePrefetch`, then `prefetch`, then `true`.                   |
| `ssg`                | Left unset until config is loaded; explicit, config, then `true`. |
| `dryRun`             | Explicit value, otherwise `false`.                                |
| `include`, `exclude` | Passed to route collection without implicit rewriting.            |

`ssg: false` collects no static routes. A non-dry build that consequently
emits no pages is rejected because it is not a deployable static artifact.

## Publication contract

[`build/build-publication.ts`](./build/build-publication.ts) provides the local
filesystem transaction.

- The lock is created exclusively next to the final output and contains a
  random ownership token.
- Concurrent builds for the same output serialize or time out.
- Build content is written to
  `.<output>.veryfront-stage-<id>`.
- An existing output is renamed to
  `.<output>.veryfront-backup-<id>` only when the staged build is ready.
- Promotion uses same-parent filesystem renames.
- A failed promotion restores the previous output.
- Backup, staging, and lock cleanup is retryable and coalesces concurrent
  calls.
- Lock ownership is verified before removal.
- A backup-deletion failure is retried during cleanup and cannot disappear as
  a warning-only success.

If both promotion and restoration fail, the backup is deliberately preserved
for recovery rather than deleted by generic cleanup.

Dry runs do not create stage, backup, or lock artifacts.

## Output contract

A successful static build can contain:

```text
<output>/
├── _veryfront/
│   ├── app.js
│   ├── client.js
│   ├── router.js
│   ├── prefetch.js
│   ├── hydration-runtime.js
│   ├── manifest.json
│   ├── chunks/
│   │   ├── manifest.json
│   │   └── ...
│   └── release-asset-manifest.json
├── <route>/index.html
├── sw.js
├── _redirects
└── <copied public assets>
```

The chunk manifest exists only when script-based Pages routes are split. The
release-asset manifest exists only when local dependency import-map generation
is enabled. Compression adds supported `.gz` and `.br` sidecars without
replacing the source files.

`_veryfront/manifest.json` uses
`PRODUCTION_BUILD_FORMAT_VERSION`. Its routes and chunk metadata are
canonicalized into a detached, deterministic snapshot before serialization.
Reported route and chunk counts must agree with generated output.

## Code-splitting boundary

The code splitter:

- accepts canonical, NFC route paths only;
- rejects duplicate routes and generated entry-name collisions;
- resolves project modules through physical project boundaries;
- reads only stable regular source files up to 32 MiB;
- rejects invalid UTF-8 and source files that change during the read;
- filters external imports from asset references;
- validates chunk sizes against bundler metadata;
- rejects output and symbolic-link escapes;
- produces stable route, chunk, import, preload, and shared ordering; and
- validates the complete referential graph before returning or writing a
  manifest.

Build contexts and their injected shim files have coalesced, retryable
disposal. Rebuild and disposal failures are both retained.

## Public-asset boundary

`discoverStaticAssets()` and `copyStaticAssets()` treat `<projectDir>/public`
as untrusted input:

- discovery is deterministic and bounded;
- symbolic links and unsupported entry types are rejected;
- generated/reserved paths and portable case or Unicode collisions are
  rejected;
- all destinations are preflighted before the first copy;
- binary bytes pass through the selected runtime adapter; and
- a failed copy rolls back files and directories created by that attempt.

Missing `public` is a valid empty inventory. Other discovery and adapter errors
propagate.

## Local dependency assets

When `VERYFRONT_RELEASE_ASSET_DEPENDENCY_IMPORT_MAP=1`,
`generateLocalReleaseAssetManifest()` vendors content-addressed React,
framework, and eligible cached HTTP modules.

Cached modules must be bounded regular UTF-8 files with validated HTTP(S)
provenance. Conflicting claims, hash mismatches, symbolic links, unsafe cache
roots, and unreferenced outputs fail the build. Writes are bounded,
preflighted, and rolled back on failure. The assembled manifest is parsed by
the Release Assets schema before it is returned or written.

## Files

| Path                                  | Responsibility                                  |
| ------------------------------------- | ----------------------------------------------- |
| `asset-generation.ts`                 | Discover and copy `public` assets.              |
| `client-runtime.ts`                   | Generate embedded browser runtimes.             |
| `compression.ts`                      | Create deterministic compressed sidecars.       |
| `local-release-assets.ts`             | Vendor optional local dependency assets.        |
| `manifest.ts`                         | Validate and build the production manifest.     |
| `static-generation.ts`                | Render Pages and App Router static output.      |
| `templates.ts`                        | Checked-in generated client templates.          |
| `build/build-initializer.ts`          | Normalize options and create build context.     |
| `build/output-plan.ts`                | Validate output safety and collision plans.     |
| `build/build-publication.ts`          | Lock, stage, promote, restore, and clean up.    |
| `build/route-collector.ts`            | Collect configured Pages and App routes.        |
| `build/code-splitter-orchestrator.ts` | Split eligible Pages routes.                    |
| `build/build-executor.ts`             | Coordinate Pages and App static generation.     |
| `build/output-generator.ts`           | Generate runtime and deployment output files.   |
| `build/build-cleanup.ts`              | Destroy renderer and transform-cache resources. |
| `build/build-orchestrator.ts`         | Own the end-to-end production transaction.      |

## Verification

Focused production-build verification:

```bash
deno test --frozen --allow-all src/build/production-build
deno lint src/build/production-build
deno check --frozen \
  src/build/index.ts \
  src/build/production-build/index.ts
```

Changes to client runtime generation must also run the checked-in generated
source comparison in `client-runtime.test.ts`. Changes to public behavior or
examples require `deno task docs:validate` and the repository consumer
type-check.
