# Build Module

This is the module overview and public API reference for `src/build/`.
For the user-facing build and deployment procedure, see
[Build and deploy](../../docs/guides/deploying.md). For the cross-module design,
see [Build pipeline](../../docs/architecture/14-build-pipeline.md).

## Responsibility

The build module owns:

- production static-page generation for Pages and App Router routes;
- client runtime generation and route-based JavaScript code splitting;
- public-asset copying, output manifests, redirects, service workers, and
  optional compression;
- MDX compilation and directory watching;
- provider-neutral CSS and image orchestration;
- embedded-runtime bundle generation.

It does not own development serving, runtime request dispatch, deployment, or
runtime adapter selection.

CSS compilation, optimization, and purging implementations live outside this
module. Build resolves the `CSSProcessor`, `CSSOptimizationEngine`, and
`CSSPurgingEngine` contracts supplied by explicitly composed extensions. It does
not import vendor engines or substitute a local fallback when a requested
contract is unavailable.

## Public package surface

Applications import the supported package API from `veryfront/build`:

| Export                                  | Contract                                                   |
| --------------------------------------- | ---------------------------------------------------------- |
| `buildProduction(options)`              | Generate and atomically publish a production static build. |
| `compileMDXToJS(path, source, options)` | Compile one MDX program to JavaScript.                     |
| `compileAllMDX(options)`                | Compile an MDX source tree.                                |
| `watchMDX(options)`                     | Watch and recompile an MDX source tree.                    |
| `buildEmbeddedPreset(options)`          | Build a Deno, Node.js, or Bun embedded preset.             |
| `LOCAL_RELEASE_ASSET_MANIFEST_PATH`     | Path of the optional local dependency manifest.            |

`BuildOptions` and `BuildStats` are exported from `veryfront/server`. The MDX
compiler types (`CompileOptions`, `CompileResult`, `MDXFrontmatter`) are
exported from `./compiler/mdx-compiler/index.ts` and are not part of the
`veryfront/build` surface.

Files below `src/build/production-build/` and `src/build/bundler/` are
maintainer internals; they are not additional package entry points.

## Production build API

```typescript
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

The direct API defaults `outputDir` to `<projectDir>/.veryfront/output`. The
`veryfront build` CLI deliberately defaults to `<projectDir>/dist`.

### Options

| Option               | Behavior                                                       |
| -------------------- | -------------------------------------------------------------- |
| `projectDir`         | Required project directory. It must exist and be a directory.  |
| `outputDir`          | Final output directory.                                        |
| `enableSplitting`    | Enable code splitting; defaults to `true`.                     |
| `enableCompression`  | Emit supported compressed sidecars; defaults to `true`.        |
| `enablePrefetch`     | Enable generated prefetch behavior; defaults to `true`.        |
| `ssg`                | Explicit value, then `build.ssg`, then `true`.                 |
| `include`, `exclude` | Route collection filters.                                      |
| `dryRun`             | Validate and execute build planning without publishing output. |

`BuildOptions` also declares the shorthand fields `splitting`, `compress`, and
`prefetch`. These are the CLI-facing spelling: `veryfront build` translates them
into the corresponding `enable*` options. `buildProduction()` itself reads only
the `enable*` options and ignores the shorthand, so direct API callers must use
the verbose form.

A non-dry production build that emits no pages and no chunks is rejected rather
than publishing an empty artifact.

### Result

`buildProduction()` returns:

```typescript
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

`totalSize` is measured in bytes and `duration` in milliseconds.

## Publication and failure contract

A production build:

1. validates the project and output boundaries;
2. discovers routes and public assets;
3. writes into a unique sibling staging directory while holding an
   output-specific lock;
4. promotes the completed staging directory with filesystem renames;
5. restores the previous output if promotion fails; and
6. removes staging, backup, and lock resources.

The previous output remains intact until a complete replacement is ready.
Atomic publication requires filesystem rename support, and a custom publication
filesystem must supply a matching lock provider. Cleanup failures are reported
without masking the original error.

## Source structure

```text
src/build/
├── asset-pipeline/       Provider-neutral CSS and image orchestration
├── bundler/              Project-module resolution and code splitting
├── compiler/             MDX compilation and watching
├── embedded/             Embedded-runtime preset generation
├── production-build/     Static build orchestration and output generation
├── renderer/             Build-time MDX and script bundling services
├── utils/                Build-local utilities
├── index.ts              Public `veryfront/build` package surface
├── vendor-bundle.ts
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
- Extensions own CSS compiler, optimizer, purger, base stylesheet, and plugin
  implementations; Build owns their validated orchestration.
- Server owns `BuildOptions` and `BuildStats` because the CLI and server share
  those contracts.

Cross-module imports use package or declared internal aliases. Relative imports
remain inside the Build module. Only exports from `src/build/index.ts` form the
`veryfront/build` package API.

## Related modules

- [`server/`](../server/README.md) - Development server
- [`rendering/`](../rendering/README.md) - SSR/RSC rendering
- [`transforms/`](../transforms/README.md) - Code transforms
- [`cli/`](../../cli/README.md) - CLI commands

## Extension contracts

The provider packages for the optional asset stages are
[`@veryfront/ext-image-sharp`](../../extensions/ext-image-sharp/README.md),
[`@veryfront/ext-css-lightning`](../../extensions/ext-css-lightning/README.md),
and [`@veryfront/ext-css-tailwind`](../../extensions/ext-css-tailwind/README.md).
An unconfigured stage is skipped. An enabled stage with a missing provider or a
provider failure rejects the build.

## References

- [esbuild Documentation](https://esbuild.github.io/)
- [MDX Documentation](https://mdxjs.com/)
