# Build pipeline

This page describes production build, bundling, asset processing, and compiler
support. It does not cover runtime request handling.

## Responsibility

The build pipeline collects static routes, compiles and renders source files,
bundles browser runtimes, copies public assets, emits validated manifests, and
publishes a complete production output. Standalone Build utilities also
compile MDX and optimize CSS, Tailwind sources, and images.

Primary source areas:

- [`src/build/`](../../src/build/)
- [`src/build/production-build/`](../../src/build/production-build/)
- [`src/build/bundler/`](../../src/build/bundler/)
- [`src/build/compiler/`](../../src/build/compiler/)
- [`src/build/asset-pipeline/`](../../src/build/asset-pipeline/)
- [`src/transforms/`](../../src/transforms/)

## Build flow

1. Option normalization and project inspection establish the requested build.
2. Configuration and rendering initialize through the selected runtime
   adapter.
3. Output-boundary validation rejects project/source overlap, unsafe existing
   output, reserved paths, and portable route or public-asset collisions.
4. Route collection discovers configured Pages and App Router entries.
5. The publication layer acquires an output-specific lock and allocates a
   sibling staging directory.
6. Eligible script routes are code split; Pages and App routes are rendered
   into the stage.
7. Output generation writes client runtimes, public assets, the build
   manifest, service worker, redirects, optional local dependency assets, and
   optional compressed sidecars.
8. A zero-page artifact is rejected. A complete stage atomically replaces the
   previous output.
9. Publication resources, renderer state, and transform caches are cleaned up;
   cleanup failures remain observable.

The CSS, image, Tailwind, MDX-directory, and embedded-preset APIs have their own
transactional output boundaries. They are Build capabilities, but they are not
all implicit stages of `buildProduction()`.

## Boundaries

- Server runtime consumes build output but does not own production build steps.
- Runtime adapters describe host capabilities, not build graph semantics.
- Extension-provided bundler contracts belong in [extension system](./12-extension-system.md).
- The final production output is local and same-filesystem rename capable.
- Build output must not contain the project or overlap `public`, Pages, or App
  source directories.
- Asset-stage output trees must not overlap. Transactional stages publish their
  complete output directory rather than exposing partial files.
- Chunk and production manifests are bounded, deterministic, and
  referentially validated before publication.

## Change checks

- Add regression tests for route collection, publication rollback, manifest
  consistency, generated assets, and cleanup behavior when changing output.
- Run `deno test --frozen --allow-all src/build`, `deno lint src/build`, and
  type-check the Build entry points.
- Run documentation validation and consumer type-checks when public options,
  exports, examples, or generated references change.

## Related guides

- [Deploying](../guides/deploying.md)

## Related reference

- [CLI reference](../api-reference/veryfront/cli.md)
