# Transforms reference

The transforms module compiles TypeScript, JSX, Markdown, and MDX into executable
ES modules. It also rewrites imports, scopes CSS Modules, caches remote modules,
and loads compiled MDX through the ESM runtime.

This page is a reference for maintainers. Application code normally reaches
these features through Veryfront build and rendering APIs.

## Module layout

| Path                     | Responsibility                                                                    |
| ------------------------ | --------------------------------------------------------------------------------- |
| `esm/`                   | ESM utilities, HTTP module caching, import-map helpers, and compatibility exports |
| `pipeline/`              | Ordered SSR and browser transform stages and transform caching                    |
| `import-rewriter/`       | Strategy-based import classification and URL construction                         |
| `css-modules/`           | Deterministic CSS Module keys, hashes, and selector rewriting                     |
| `md/`                    | Markdown compilation through the content extension contract                       |
| `mdx/compiler/`          | MDX compilation, frontmatter extraction, and compiled import rewriting            |
| `mdx/esm-module-loader/` | Secure ESM loading, module persistence, dependency recovery, and cache namespaces |
| `plugins/`               | Content-extension plugin lookup and the core Babel node-position pass             |
| `shared/`                | Validation and naming helpers shared by transform subsystems                      |

`index.ts` is the internal `#veryfront/transforms` barrel. The public import map
currently exposes only `veryfront/transforms/mdx-cache` from this domain.

## ESM transform entry points

### `runPipeline`

`runPipeline(source, filePath, projectDir, options, config?)` returns a
`Promise<TransformResult>`.

| Parameter    | Type               | Description                                      |
| ------------ | ------------------ | ------------------------------------------------ |
| `source`     | `string`           | Source module text                               |
| `filePath`   | `string`           | Source module path                               |
| `projectDir` | `string`           | Project root used for path containment           |
| `options`    | `TransformOptions` | Required project identity and transform settings |
| `config`     | `PipelineConfig`   | Optional debug, timing, and custom plugin config |

`TransformResult` contains `code`, `contentHash`, per-stage `timing`, `totalMs`,
and the `cached` flag.

### `transformToESM`

`transformToESM(source, filePath, projectDir, adapter, options)` returns a
`Promise<string>`. It is the compatibility wrapper used by module loaders. CSS
and JSON input is returned unchanged. When `options.readFile` is absent, the
wrapper derives a reader from the runtime adapter or the platform filesystem.

Dependency hashing is enabled when a reader is available. Dependency paths must
stay inside `projectDir`, including after symbolic-link resolution. A dependency
read or hash failure rejects the transform instead of using a stale cache key.

## Pipeline order

The SSR pipeline runs these stages:

1. Parse Markdown or MDX.
2. Compile TypeScript, JSX, or TSX with esbuild.
3. Replace CSS imports and record their source-order metadata.
4. Rewrite aliases, React imports, npm packages, relative imports, and cross-project imports.
5. Resolve Veryfront framework modules to local ESM cache files.
6. Normalize and cache HTTP modules.
7. Finalize generated code.

The browser pipeline omits the SSR-only framework and HTTP cache stages.

## MDX loading

Synchronous string evaluation is disabled.

`mdxRenderer.loadModuleESM(compiledProgramCode, adapter?, projectId?, projectDir?,
projectSlug?, contentSourceId?, reactVersion?)` returns a `Promise<MDXModule>`.
The loaded module can expose `MDXContent` or a default component export.

`MDXRenderer.render()` remains only as a deprecated compatibility signal. It
returns an element marked with `data-veryfront-error="mdx-sync-render-disabled"`
and does not render compiled content.

## Cache and security invariants

- Transform cache keys include source, configuration, and dependency state.
- Remote JavaScript and MDX responses have a fixed body limit and a request timeout.
- Remote request errors do not include URLs, query strings, response previews, or raw network errors.
- Cross-project and npm specifiers reject traversal, encoded traversal, URL delimiters, and control characters.
- MDX ESM cache indexes accept only `.mjs` paths inside their cache namespace.
- Cache lookup checks canonical paths so a symbolic link cannot escape its namespace.
- Generated comments never interpolate raw import specifiers or source URLs.
- CSS Module rewriting changes selector classes only. It preserves comments, strings, URLs, declarations, and `:global(...)` content.

## Related modules

- `src/modules/` consumes transformed ESM through module-server and loader APIs.
- `src/rendering/` loads compiled MDX and applies layout components.
- `src/release-assets/` consumes cached module manifests during release builds.
