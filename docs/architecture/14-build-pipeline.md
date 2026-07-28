# Build pipeline

This page describes production build, bundling, asset processing, and compiler
support. It does not cover runtime request handling.

## Responsibility

The build pipeline collects routes, compiles source files, bundles runtime
assets, optimizes CSS and images, emits manifests, and prepares production
output.

Primary source areas:

- [`src/build/`](../../src/build/)
- [`src/build/production-build/`](../../src/build/production-build/)
- [`src/build/bundler/`](../../src/build/bundler/)
- [`src/build/compiler/`](../../src/build/compiler/)
- [`src/build/asset-pipeline/`](../../src/build/asset-pipeline/)
- [`src/transforms/`](../../src/transforms/)

## Build flow

1. Build setup initializes the project build context.
2. Route collection discovers page and API entrypoints.
3. Compiler and transform code converts MDX, CSS, import maps, and ESM inputs.
4. Bundler code splits client and server entrypoints.
5. Requested asset stages run in Tailwind, CSS, then image order. Omitted
   stages are no-ops; enabled-stage failures reject instead of returning
   partial-success statistics.
6. Output generation writes manifests and production files.

## Boundaries

- Server runtime consumes build output but does not own production build steps.
- Runtime adapters describe host capabilities, not build graph semantics.
- Extension-provided bundler contracts belong in [extension system](./12-extension-system.md).
- Asset-stage output trees must not overlap. Each stage stages and atomically
  publishes its own output directory.

## Change checks

- Add tests for route collection, manifest output, generated assets, and
  transform behavior when changing build output.
- Run build verification when public build output or generated references change.

## Related guides

- [Deploying](../guides/deploying.md)

## Related reference

- [CLI reference](../api-reference/veryfront/cli.md)
