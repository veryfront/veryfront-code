# Build architecture

The build domain turns a Veryfront project into deployable output. It owns MDX
compilation, route bundling, static rendering, client runtime generation,
asset processing, release dependency materialization, and embedded runtime
bundles.

This page explains how those responsibilities fit together. See the
[production build API reference](./production-build/README.md) for exact
internal signatures and output paths.

## Boundaries

The build domain coordinates several neighboring domains without replacing
them:

- `config/` resolves project configuration.
- `discovery/` and `server/` supply route discovery and shared route contracts.
- `rendering/` supplies SSR and the browser runtime source.
- `transforms/` compiles modules and manages transform caches.
- `release-assets/` prepares content-addressed dependency assets and validates
  their manifest.
- `platform/` supplies runtime and filesystem adapters for Deno, Node.js, and
  Bun.

Development serving, request handling, deployment, and control-plane behavior
remain outside `src/build/`.

## Module layout

```text
src/build/
├── asset-pipeline/          CSS, image, and Tailwind processing
│   ├── css-optimizer/
│   ├── image-optimizer/
│   └── tailwind-processor/
├── bundler/                 Route-aware code splitting and chunk manifests
├── compiler/                MDX and Markdown compilation
│   └── mdx-compiler/        Project-wide compilation and watching
├── embedded/                Deno, Node.js, and Bun embedded bundles
├── production-build/        Transactional production build orchestration
│   └── build/               Setup, execution, output, and cleanup stages
├── renderer/                Build-time MDX, script, and CSS bundling services
├── utils/                   Shared file, glob, CSS, and asset helpers
├── binary-plugin-includes.ts
├── vendor-cache.ts
└── index.ts                 Primary build barrel
```

## Production build flow

`buildProduction()` is the composition root for production output. A build has
the following phases:

1. Normalize paths and feature flags, then load the runtime adapter, project
   config, and renderer.
2. Create a sibling staging directory for the output transaction.
3. Prepare local release dependency assets when release dependency import maps
   are enabled.
4. Discover Pages Router and App Router routes when SSG is enabled.
5. Build the Pages Router chunk graph when splitting is enabled.
6. Render static routes and write their HTML, data, modules, and generated CSS.
7. Generate the browser runtime, copy public assets, and write the build
   manifest, service worker, and redirects file.
8. Clean runtime resources and atomically replace the previous output with the
   completed staging directory.

Dry runs execute validation and rendering work but do not materialize or
replace output.

The sibling staging directory is deliberate. A failed build removes its
staging output and preserves the last complete build. If commit or restoration
also fails, the error retains both failures in an `AggregateError`.

## Compilation paths

The build domain exposes two MDX compilation levels:

- `compileMDXToJS()` compiles one `.md` or `.mdx` source string into a
  standalone ESM module and normalized frontmatter.
- `compileAllMDX()` discovers `.mdx` files in configured project directories,
  compiles them, and reports all per-file failures together.

`watchMDX()` uses the same project-boundary validation as batch compilation.
It ignores unrelated filesystem events and closes the runtime watcher when its
abort signal fires.

## Asset paths

The asset pipeline contains independent CSS, image, and Tailwind processors.
The production build uses its own narrower asset path for public files and
generated App Router CSS:

- Public files are copied without following symbolic links.
- Reserved runtime paths such as `_veryfront/`, `_vf/`, `sw.js`, and
  `_redirects` cannot be replaced by project assets.
- Tailwind source discovery has explicit depth, entry-count, file-count,
  per-file byte, and aggregate byte limits.
- Image output is committed as a complete transaction so a failed optimization
  does not expose a partial manifest.

The optional asset-pipeline orchestration barrel is internal to the repository.
It is not part of the primary `src/build/index.ts` surface.

## Release dependency assets

Local production output can include immutable JavaScript dependencies under
`/_vf/assets`. Every prepared asset is verified against its declared SHA-256
hash, size, and content type before any file is written. The generated manifest
is parsed through the shared release manifest validator and may reference only
verified assets.

The source-content hash is derived from the React version, sorted dependency
descriptors, and sorted gaps. It is independent of local cache paths and file
discovery order.

## Dependency shape

The primary direction inside the domain is:

```text
production-build -> bundler
embedded -> compiler, renderer, production-build transaction support
asset-pipeline -> build utilities
renderer -> build utilities
```

The root barrel composes compiler, embedded, and production-build entry points.
Internal source imports use `#veryfront/*`; package-facing code uses
`veryfront/*`. Build files use direct module imports for implementation details
and barrels only for stable sibling contracts.

## Reliability rules

The build implementation relies on these invariants:

- Project inputs and output destinations are nonblank, normalized, and checked
  with complete path segments.
- Filesystem discovery does not follow symbolic links unless a caller provides
  an explicit canonical-path policy.
- Manifests and maps use deterministic ordering before serialization.
- Potentially large source sets have file-count and byte budgets before content
  is retained in memory.
- Public behavior does not depend on machine-specific absolute paths.
- Cleanup failures are preserved instead of hiding the primary build failure.

## Related architecture

- [Production build API reference](./production-build/README.md)
- [Rendering architecture](../rendering/README.md)
- [Server architecture](../server/README.md)
- [Transform architecture](../transforms/README.md)
- [CLI architecture](../../cli/README.md)
