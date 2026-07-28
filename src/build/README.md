# Build module

This is the module overview and public API reference for `src/build/`.
For the user-facing build and deployment procedure, see
[Build and deploy](../../docs/guides/deploying.md). For the cross-module design,
see [Build pipeline](../../docs/architecture/14-build-pipeline.md).

## Responsibility

The Build module owns:

- production static-page generation for Pages and App Router routes;
- client runtime generation and route-based JavaScript code splitting;
- public-asset copying, output manifests, redirects, service workers, and
  optional compression;
- MDX compilation and directory watching;
- standalone CSS, image, and Tailwind build utilities;
- embedded-runtime bundle generation.

It does not own development serving, runtime request dispatch, deployment, or
runtime adapter selection.

## Public package surface

Applications import the supported package API from `veryfront/build`.

| Export                                              | Contract                                                   |
| --------------------------------------------------- | ---------------------------------------------------------- |
| `buildProduction(options)`                          | Generate and atomically publish a production static build. |
| `compileMDXToJS(source, options)`                   | Compile one MDX program to JavaScript.                     |
| `compileAllMDX(options)`                            | Compile an MDX source tree.                                |
| `watchMDX(options)`                                 | Watch and recompile an MDX source tree.                    |
| `buildEmbeddedPreset(options)`                      | Build a Deno, Node.js, or Bun embedded preset.             |
| `LOCAL_RELEASE_ASSET_MANIFEST_PATH`                 | Path of the optional local dependency manifest.            |
| `CompileOptions`, `CompileResult`, `MDXFrontmatter` | Types for directory compilation and watching.              |
| `BuildEmbeddedOptions`                              | Options for embedded preset generation.                    |

`BuildOptions` and `BuildStats` are exported from `veryfront/server`.
Files below `src/build/production-build/` and `src/build/bundler/` are
maintainer internals; they are not additional package entry points.

## Production build API

```ts
import { buildProduction } from "veryfront/build";
import type { BuildOptions, BuildStats } from "veryfront/server";

const options: BuildOptions = {
  projectDir: "./site",
  outputDir: "./dist",
  enableSplitting: true,
  enableCompression: true,
  enablePrefetch: true,
};

const stats: BuildStats = await buildProduction(options);
console.log(`${stats.pages} pages in ${stats.duration} ms`);
```

The direct API defaults `outputDir` to
`<projectDir>/.veryfront/output`. The `veryfront build` CLI deliberately
defaults to `<projectDir>/dist`.

### Options

| Option                           | Behavior                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `projectDir`                     | Required project directory. It must exist and be a directory.  |
| `outputDir`                      | Final output directory.                                        |
| `enableSplitting` / `splitting`  | Enable code splitting; defaults to `true`.                     |
| `enableCompression` / `compress` | Emit supported compressed sidecars; defaults to `true`.        |
| `enablePrefetch` / `prefetch`    | Enable generated prefetch behavior; defaults to `true`.        |
| `ssg`                            | Explicit value, then `build.ssg`, then `true`.                 |
| `include`, `exclude`             | Route collection filters.                                      |
| `dryRun`                         | Validate and execute build planning without publishing output. |

When a verbose `enable*` option and its shorthand are both present, the
verbose option wins. A non-dry production build that emits zero pages is
rejected rather than publishing an empty artifact.

### Result

`buildProduction()` returns:

```ts
interface BuildStats {
  pages: number;
  components: number;
  chunks: number;
  assets: number;
  totalSize: number;
  duration: number;
  ssgPaths?: string[];
}
```

Counts and sizes are non-negative. `totalSize` is measured in bytes and
`duration` in milliseconds.

## Publication and failure contract

A production build:

1. validates the project and output boundaries;
2. discovers routes and public assets, then preflights output collisions;
3. writes into a unique sibling staging directory while holding an
   output-specific lock;
4. promotes the completed staging directory with filesystem renames;
5. restores the previous output if promotion fails; and
6. removes staging, backup, lock, renderer, and cache resources.

The previous output remains intact until a complete replacement is ready.
Operational, rollback, and cleanup failures are surfaced. When a primary
operation and cleanup both fail, the primary failure remains first in the
reported aggregate.

Source files, generated manifests, and build paths are bounded and validated.
Symbolic-link escapes, non-canonical route paths, invalid UTF-8 source modules,
portable output collisions, and mismatched manifest references fail closed.

## Source structure

```text
src/build/
├── asset-pipeline/       Standalone CSS, image, and Tailwind processors
├── bundler/              Project-module resolution and code splitting
├── compiler/             MDX compilation and watching
├── embedded/             Embedded-runtime preset generation
├── production-build/     Static build orchestration and output generation
├── renderer/             Build-time MDX and script bundling services
├── utils/                Build-local utilities
├── index.ts              Public `veryfront/build` package surface
├── binary-plugin-includes.ts
└── vendor-cache.ts
```

The detailed production pipeline is documented in
[production-build/README.md](./production-build/README.md).

## Dependency boundaries

- Rendering owns SSR behavior; Build invokes it to produce static output.
- Config owns configuration loading and schema validation.
- Platform adapters provide host capabilities; Build owns build semantics.
- Transforms own reusable source transformations.
- Release Assets owns dependency-manifest parsing and validation.
- Server owns `BuildOptions` and `BuildStats` because the CLI and server share
  those contracts.

Use package or declared internal aliases. Do not add cross-module relative
imports or expose a new package API by exporting an internal helper
incidentally.

## Maintainer verification

Run the focused module gate after changing Build:

```bash
deno test --frozen --allow-all src/build
deno lint src/build
deno check --frozen \
  src/build/index.ts \
  src/build/bundler/index.ts \
  src/build/production-build/index.ts
deno task docs:validate
```

Changes to generated client sources also require the manifest-generation and
consumer type-check gates used by repository verification.
