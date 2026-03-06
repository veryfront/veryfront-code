# NLSpec: src/transforms/

## Purpose

The transforms module converts user-authored TypeScript/JSX/MDX source code into browser-compatible ESM and server-side-renderable JavaScript. It provides a plugin-based pipeline architecture for ESM transformation, a unified import rewriting system with strategy pattern, MDX/Markdown compilation with multi-tier caching (LRU in-memory, local filesystem, distributed Redis), and remark/rehype plugins for content enrichment. The module is the core compilation layer used by the development module server, the SSR rendering pipeline, and the build system.

## Public API

### Exports (from `index.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `transformToESM` | function | Main entry: transforms source code to ESM via the pipeline |
| `runPipeline` | function | Lower-level pipeline runner with full config control |
| `TransformStage` | enum | Pipeline stage ordering (PARSE through FINALIZE) |
| `PipelineConfig` | type | Pipeline configuration (debug, plugins) |
| `PipelineContext` | type | Alias for TransformContext |
| `PipelineOptions` | type | Alias for TransformOptions |
| `TransformContext` | type | Mutable context passed through pipeline stages |
| `TransformOptions` | type | Options for transform (ssr, dev, projectId, etc.) |
| `TransformPlugin` | type | Plugin interface (name, stage, condition, transform) |
| `TransformResult` | type | Result with code, hash, timing, cached flag |
| `computeShortContentHash` | function | 8-char content hash for cache keys |
| `getLoaderFromPath` | function | Maps file extension to esbuild loader |
| `needsTransform` | function | Check if file extension needs transformation |
| `addDepsToEsmShUrls` | function | Add `?external=react` to bare esm.sh URLs |
| `resolveReactImports` | function | Rewrite react imports to esm.sh URLs |
| `resolvePathAliases` | function | Rewrite `@/` imports to relative paths |
| `resolveRelativeImports` | function | Normalize relative import extensions |
| `rewriteBareImports` | function | Rewrite bare npm imports to esm.sh URLs |
| `rewriteVendorImports` | function | Rewrite React imports to vendor bundle URL |
| `MDXRenderer` | class | MDX module loader with LRU cache |
| `mdxRenderer` | Proxy | Lazy singleton proxy for MDXRenderer |
| `clearMDXRendererCache` | function | Clear the MDX renderer LRU cache |
| `MDXCacheAdapter` | class | MDX compilation with distributed caching |
| `MDXCacheAdapterOptions` | type | Options for MDXCacheAdapter |
| `MDXCompilationResult` | type | Result of MDX compilation |
| `MDXRenderOptions` | type | Options for MDX rendering |
| `getRemarkPlugins` | function | Default remark plugin list |
| `getRehypePlugins` | function | Default rehype plugin list |
| `rehypeNodePositions` | function | Inject source positions into HTML elements |
| `remarkCodeBlocks` | function | Add language classes and line number metadata |
| `remarkMdxHeadings` | function | Extract headings with slug IDs |
| `remarkMdxImports` | function | Extract import paths from MDX |
| `remarkMdxRemoveParagraphs` | function | Unwrap unnecessary `<p>` elements in MDX |
| `clearAllLocalCaches` | function | Clear all MDX ESM module loader local caches |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `esbuild` | `#veryfront/platform/compat/esbuild.ts` | JSX/TS to JS compilation |
| `es-module-lexer` | `es-module-lexer` | Parse import/export statements without full AST |
| `@babel/parser`, `@babel/traverse`, `@babel/generator`, `@babel/types` | Babel packages | TSX node position injection for Studio Navigator |
| `rehype-highlight`, `rehype-slug` | Rehype ecosystem | Syntax highlighting and heading anchors |
| `remark-gfm`, `remark-frontmatter` | Remark ecosystem | GitHub-flavored markdown and frontmatter parsing |
| `github-slugger` | `github-slugger` | Deterministic heading ID generation |
| `mdast-util-to-string`, `unist-util-visit` | Unified ecosystem | AST traversal and text extraction |
| `#veryfront/cache/*` | Internal cache system | Distributed cache backends, key builders, path tokenization |
| `#veryfront/platform/compat/*` | Platform compat layer | Cross-runtime filesystem, React paths, esbuild |
| `#veryfront/observability/*` | Observability | OpenTelemetry tracing spans |
| `#veryfront/utils/*` | Utilities | Logging, hashing, constants, LRU cache |
| `#veryfront/modules/import-map/*` | Import map module | WHATWG import map resolution |
| `#veryfront/config/*` | Configuration | Environment config, React version detection |

## Behaviors

### Behavior 1: ESM Transform Pipeline

- **Given**: Source code (TSX/JSX/TS/MDX), file path, project directory, and transform options
- **When**: `transformToESM()` or `runPipeline()` is called
- **Then**: Code passes through ordered pipeline stages: parse MDX (if applicable) -> esbuild compile -> CSS strip -> resolve imports (unified rewriter) -> SSR-specific stages (VF modules, HTTP stub, HTTP cache) -> finalize. Returns transformed code with content hash and timing.
- **Edge cases**: `.css` and `.json` files are returned unchanged. Cache hits skip the pipeline entirely. SSR cache hits are validated for bundle existence before returning.

### Behavior 2: Unified Import Rewriting

- **Given**: Compiled JavaScript code with various import specifier types
- **When**: The `resolveImportsPlugin` stage runs (or `rewriteImports()` is called directly)
- **Then**: Each import specifier is classified and processed by the first matching strategy in priority order: node builtins (0.5) -> React packages (0) -> `@/` aliases (1) -> `veryfront/*` framework (1.5) -> bare npm (2) -> relative `./` (3) -> cross-project (4) -> import map SSR (5) -> vendor bundle (6) -> esm.sh URL (7). The code is parsed once via es-module-lexer and all rewrites applied in a single pass.
- **Edge cases**: HTTP URLs in string literals (not imports) are masked before parsing to avoid false positives. Dynamic imports preserve quote style. Bare strategy skips SSR target (import map handles it). Vendor strategy only activates when vendorBundleHash is present.

### Behavior 3: HTTP Module Caching (SSR)

- **Given**: SSR-transformed code containing `https://esm.sh/` import URLs
- **When**: The `ssrHttpCachePlugin` stage runs
- **Then**: Each HTTP URL is fetched, its imports are recursively rewritten to local paths, and the module is cached to `{cacheDir}/http-{hash}.mjs`. A bundle manifest is created for atomic validation. Distributed Redis cache is used as L2 with tokenized portable paths (`__VF_CACHE_DIR__`).
- **Edge cases**: Circular dependencies are detected via a processing stack. Concurrent fetches to the same URL are deduplicated. HTML error pages from esm.sh are detected and rejected. Missing bundles trigger recovery from distributed cache, URL re-fetch, or parent bundle scan.

### Behavior 4: MDX Compilation and Module Loading

- **Given**: MDX or Markdown source content with optional frontmatter
- **When**: `MDXRenderer.loadModuleESM()` is called (or the parse stage compiles MDX)
- **Then**: Content is compiled to JSX via `@mdx-js/mdx` with remark/rehype plugins, then loaded as an ESM module. The result is cached in an LRU cache keyed by content. Frontmatter, headings, and layout components are extracted as module exports.
- **Edge cases**: Synchronous `render()` is disabled for security (returns migration warning). The MDXRenderer uses a lazy Proxy singleton to defer initialization.

### Behavior 5: CSS Module Handling

- **Given**: Import statements referencing `.css` or `.module.css` files in compiled code
- **When**: The `cssStripPlugin` stage runs
- **Then**: CSS imports are stripped from JS (they would crash module loaders). For CSS Module imports, a Proxy stub is generated that returns the property name as the class name (identity mapping), with optional scoped naming using deterministic hashing of the module key.
- **Edge cases**: Dynamic CSS imports return `Promise.resolve({})`. Named imports from CSS modules get individual string constants. Mixed default + named imports are handled.

### Behavior 6: SSR VF Modules Resolution

- **Given**: SSR code with `/_vf_modules/_veryfront/` import paths (framework components)
- **When**: The `ssrVfModulesPlugin` stage runs
- **Then**: Each VF module path is resolved to the actual framework source file, compiled (with React imports rewritten to esm.sh URLs), cached to disk under a `framework/` directory, and the import path is rewritten to `file://` pointing to the cached file.
- **Edge cases**: Circular dependency detection prevents infinite loops. Relative imports within framework files are recursively resolved. Multiple lookup directories are searched for source files.

### Behavior 7: Transform Caching

- **Given**: A transform pipeline result and a cache key derived from file path, content hash, SSR mode, studio embed flag, deps hash, and config hash
- **When**: A subsequent transform request arrives for the same file
- **Then**: The cached result is returned if: (1) the cache key matches, (2) for SSR, all HTTP bundles and framework bundles exist locally, and (3) no unresolved `/_vf_modules/` imports remain in cached code. Otherwise the pipeline re-runs.
- **Edge cases**: Distributed cache entries are tokenized (absolute paths replaced with `__VF_CACHE_DIR__`). Cache warmup and pre-warming APIs exist for startup optimization.

### Behavior 8: Studio Node Position Injection

- **Given**: TSX source code and the `studioEmbed` option enabled
- **When**: MDX compilation runs with studio embed, or Babel node positions are injected
- **Then**: `data-node-file`, `data-node-name`, `data-node-line`, `data-node-column` attributes are injected into JSX elements (via Babel for TSX, via rehype plugin for MDX). SVG elements, fragments, and head/meta elements are skipped.

## Constraints

- All React packages must use the same esm.sh URL (with consistent version, `external=react`, `deps=csstype`) to prevent multiple React instances in SSR.
- HTTP bundle code stored in distributed cache must be tokenized (no absolute paths) and detokenized on retrieval.
- The es-module-lexer must be initialized (async) before any import parsing.
- HTTP URLs in non-import string literals must be masked before parsing to avoid es-module-lexer misinterpretation.
- Pipeline stages must execute in stage order; custom plugins are sorted into the sequence.

## Error Handling

- esbuild compilation failures throw with file path and error detail, and record the error in the error collector for user-facing display.
- HTTP fetch failures (timeout, non-200, HTML responses) throw descriptive errors with URL context.
- Cache invariant violations (hardcoded paths in portable code, or tokens in local code) throw `VeryfrontError` with slug `cache-invariant-violation` and are never caught/suppressed.
- Pipeline stage failures log the stage name and file path, then re-throw.
- Distributed cache operations fail gracefully (log and continue) except for invariant violations.

## Side Effects

- Writes HTTP module cache files to disk (`{cacheDir}/http-{hash}.mjs`).
- Writes framework module cache files to disk (`{cacheDir}/framework/vfmod-{hash}.mjs`).
- Reads/writes distributed cache (Redis) for HTTP bundles, bundle manifests, and transform results.
- Fetches modules from esm.sh and other HTTP URLs during SSR transforms.
- Registers cache metrics via `registerCache()`.
- Fires OpenTelemetry spans for pipeline stages and HTTP fetches.

## Performance Constraints

- Single parse per file via es-module-lexer (O(n) lexer, no full AST).
- In-flight HTTP fetch deduplication prevents thundering herd.
- LRU caches with configurable max entries prevent unbounded memory growth.
- Distributed cache TTL refresh is fire-and-forget (non-blocking).
- Bundle manifest validation uses parallel `exists()` checks.
- Transform cache uses a local Map fallback when distributed cache is unavailable.

## Invariants

- Every HTTP bundle stored in Redis has tokenized paths (`__VF_CACHE_DIR__`); every bundle loaded from Redis is detokenized before use.
- A cached transform is never returned if its HTTP bundles or framework bundles are missing from local disk.
- React packages are always externalized in esm.sh URLs (`external=react`) to prevent duplicate React instances.
- Import rewriting strategies execute in priority order; the first matching strategy wins.
- Pipeline stages execute in `TransformStage` enum order.
- Bundle hashes are numeric strings (from `simpleHash`).
