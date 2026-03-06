# NLSpec: src/build/

## Purpose

The `src/build/` module provides the complete build pipeline for Veryfront projects, encompassing MDX compilation (two paths: standalone JS output and directory-based compilation with watch), production build orchestration (route collection, code splitting, static site generation, client runtime generation, manifest creation), an asset pipeline (CSS optimization with strategy pattern, image optimization via Sharp, Tailwind CSS v4 processing via Lightning CSS), code splitting via esbuild, vendor bundle creation and caching, embedded preset generation, and renderer-level bundling services for CSS/MDX/JS. It targets Deno as its primary runtime and uses esbuild for transpilation and bundling.

## Public API

### Exports (from `src/build/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `compileMDXToJS` | function | Compile MDX content string to standalone JS module |
| `compileAllMDX` | function | Compile all MDX files in a project directory tree |
| `watchMDX` | function | Watch MDX files for changes and recompile |
| `buildProduction` | function | Run full production build orchestration |
| `buildEmbeddedPreset` | function | Build embedded preset bundle for self-hosted deployments |

### Sub-module Exports (via barrel files)

| Sub-module | Key Exports |
|------------|-------------|
| `asset-pipeline/` | `runAssetPipeline`, `CSSOptimizer`, `optimizeCSS`, `ImageOptimizer`, `TailwindProcessor`, `CSSOptimizerService`, strategy classes |
| `bundler/` | `CodeSplitter`, `createCodeSplitter`, `loadChunkManifest`, `generatePreloadLinks`, `getChunksForRoute`, manifest/entry utilities |
| `compiler/` | `compileMDXFile`, `compileAllMDX`, `watchMDX`, `compileMDXToJS` |
| `production-build/` | `buildProduction`, `executeBuild`, `generateManifest`, SSG functions, client runtime generation, route collection |
| `renderer/` | `bundleCss`, `bundleMdx`, `bundleMDXWithOptions`, `optimizeBundle`, `bundleScript`, import/loader utilities |
| `utils/` | File type detection, asset utilities (CSS file finding, image dimensions, srcset generation) |
| `config/` | `getEnvironment`, `getBuildConfig`, `isDevelopment`, `isProduction`, `isTest` |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `esbuild` | npm (native) | JS/TS bundling, transpilation, minification |
| `@mdx-js/mdx` | npm | MDX to JSX compilation |
| `#std/fs.ts` | Deno std | File walking, directory operations |
| `#std/front-matter/yaml.ts` | Deno std | YAML frontmatter extraction |
| `#veryfront/platform/adapters/*` | internal | Runtime adapter abstraction (Deno/Node) |
| `#veryfront/platform/compat/*` | internal | Cross-runtime filesystem, path, process compat |
| `#veryfront/security` | internal | Secure filesystem for path traversal prevention |
| `#veryfront/observability/tracing/*` | internal | OpenTelemetry tracing spans |
| `#veryfront/errors/*` | internal | Error creation and handling |
| `#veryfront/utils` | internal | Logging, constants, LRU cache |
| `#veryfront/transforms/plugins/*` | internal | Remark/rehype plugin loading |
| `#veryfront/config` | internal | Project configuration |
| `#veryfront/rendering/*` | internal | SSR renderer for static generation |

## Behaviors

### Behavior 1: MDX to JS Compilation (mdx-to-js.ts)
- **Given**: An MDX file path, its content string, and compile options (projectDir, mode, adapter)
- **When**: `compileMDXToJS` is called
- **Then**: Extracts YAML frontmatter, strips import statements from MDX body, compiles MDX to JSX via `@mdx-js/mdx`, generates component stubs for missing imports, wraps in a module with `MDXPage` default export, transpiles via esbuild, returns `{ code, frontmatter }`
- **Edge cases**: Frontmatter extraction falls back to manual YAML parsing if `extract()` fails; missing components render placeholder divs

### Behavior 2: Directory-based MDX Compilation (mdx-compiler/)
- **Given**: CompileOptions with projectDir, outputDir, mode
- **When**: `compileAllMDX` is called
- **Then**: Walks `pages/`, `layouts/`, `providers/` directories, compiles each `.mdx` file through the pipeline (validate -> parse frontmatter -> extract exports -> compile MDX -> generate module code -> transpile -> write), returns Map of path to CompileResult
- **Edge cases**: Skips non-existent directories; logs and continues on per-file errors

### Behavior 3: MDX File Watch (watcher.ts)
- **Given**: CompileOptions with projectDir
- **When**: `watchMDX` is called
- **Then**: Detects watchable directories (pages/layouts/providers), sets up filesystem watcher with recursive flag, recompiles `.mdx` files on modify/create events
- **Edge cases**: Returns early if no watchable directories found

### Behavior 4: Production Build Orchestration
- **Given**: BuildOptions with projectDir, optional outputDir, feature flags
- **When**: `buildProduction` is called
- **Then**: Normalizes options -> validates project dir exists -> initializes build context (adapter, config, renderer) -> sets up output directories -> collects routes (pages + app) -> runs code splitting -> executes SSR builds -> generates outputs (client scripts, assets, manifest, service worker, redirects) -> cleanup -> returns BuildStats
- **Edge cases**: Dry-run mode skips file writes; SSG can be disabled; code splitting optional

### Behavior 5: CSS Optimization
- **Given**: CSSOptimizationOptions with inputDir, outputDir, strategy flags
- **When**: `CSSOptimizer.optimize()` is called
- **Then**: Initializes Lightning CSS (if available) -> finds CSS files -> for each file: reads content, selects strategy by priority (Lightning CSS > Purge > Basic Minification), processes, writes output -> writes manifest -> returns bundle map
- **Edge cases**: Falls back to basic minification if Lightning CSS unavailable; purge strategy analyzes content files lazily on first use

### Behavior 6: Image Optimization
- **Given**: ImageOptimizationOptions with inputDir, formats, sizes
- **When**: `ImageOptimizer.optimize()` is called
- **Then**: Loads Sharp library -> finds images via directory walk -> processes in chunks (concurrency-limited) -> for each image generates variants (format x size combinations) -> writes manifest
- **Edge cases**: Sharp not available returns null (skips optimization); images smaller than target size use `withoutEnlargement`

### Behavior 7: Tailwind CSS Processing
- **Given**: TailwindProcessorOptions with inputFile, projectDir
- **When**: `TailwindProcessor.process()` is called
- **Then**: Reads CSS file via secure FS -> detects Tailwind v4 imports -> processes with Lightning CSS (or fallback) -> counts utility classes -> optionally writes output file
- **Edge cases**: Falls back to basic CSS minification if Lightning CSS unavailable; auto-detects content paths for utility scanning

### Behavior 8: Code Splitting
- **Given**: SplitOptions with routes, projectDir, outDir, mode
- **When**: `CodeSplitter.split()` is called
- **Then**: Creates entry points from routes -> builds esbuild context with splitting enabled -> rebuilds -> processes metafile outputs into entry/shared chunk maps -> builds manifest with route-to-chunk mapping -> writes manifest JSON -> returns SplitResult
- **Edge cases**: React and veryfront client modules externalized by default; MDX files get stub loader

### Behavior 9: Vendor Bundle Building
- **Given**: VendorBundleConfig with projectId, reactVersion, dependencies
- **When**: `buildVendorBundle` is called
- **Then**: Creates virtual entry importing all deps from esm.sh -> bundles with esbuild (ESM, browser) -> computes SHA-256 hash -> returns { code, hash, exports map }
- **Edge cases**: Sanitizes import specifiers to valid JS identifiers (e.g., `@radix-ui/react-dialog` -> `radixUiReactDialog`)

### Behavior 10: Vendor Cache Management
- **Given**: A VendorCacheManager instance
- **When**: Cache operations are performed
- **Then**: LRU cache with configurable max entries and TTL (env-dependent); cache keys are `vendor:{projectId}:{sha256hash}`; TTL disabled in test mode via global flag
- **Edge cases**: TTL interval disabled when `__vfDisableLruInterval` global is set or env var is truthy

### Behavior 11: Embedded Preset Build
- **Given**: BuildEmbeddedOptions with projectDir, outDir, runtime
- **When**: `buildEmbeddedPreset` is called
- **Then**: Creates embedded directory structure -> finds entry point (app/page.mdx or pages/index.mdx, or creates fallback) -> bundles app entry via esbuild -> discovers and compiles route MDX files -> copies RSC client files -> writes manifest.json
- **Edge cases**: Missing app/pages directories produce fallback component; esbuild stopped after build (unless test mode)

### Behavior 12: Critical CSS Extraction
- **Given**: CSS file path, HTML content, optimization options
- **When**: `extractCriticalCSS` is called
- **Then**: Reads CSS file -> extracts selectors from HTML (classes, IDs, tags) -> splits CSS rules into critical (matched) and remaining -> optionally minifies both -> returns sizes
- **Edge cases**: Naive rule splitting by `}` character; selector matching is substring-based

## Constraints

- Deno runtime required (uses Deno std library, import maps, `globalThis`)
- esbuild must be available as native module
- Sharp and Lightning CSS are optional runtime dependencies (graceful degradation)
- All filesystem operations go through platform compat layer or secure FS wrapper
- Path traversal protection via `createSecureFs` in build contexts

## Error Handling

- Build errors are logged and re-thrown (fail-fast for orchestration)
- Per-file compilation errors are logged and skipped (continue processing remaining files)
- Missing optional dependencies (Sharp, Lightning CSS) log warnings and fall back to alternatives
- Invalid project directories throw typed config errors
- YAML frontmatter parsing falls back to manual regex extraction

## Side Effects

- Writes compiled files to outputDir
- Writes manifests (CSS, image, chunk, build)
- Creates directory structures
- Writes service worker, redirects, client scripts
- Stops esbuild service after embedded preset build
- Dynamic imports of optional dependencies (Sharp, Lightning CSS)

## Performance Constraints

- Image optimization uses chunked concurrency (`DEFAULT_BUILD_CONCURRENCY`)
- CSS optimization processes files sequentially
- Code splitting uses esbuild's native splitting with `rebuild()` for incremental builds
- Vendor cache uses LRU with configurable TTL and max entries
- CacheManager caches computed stats (invalidated on mutation)

## Invariants

- Build config values are environment-dependent: production enables minification/tree-shaking/es2020 target; development enables sourcemaps/esnext target
- Exactly one environment flag is true at any time (development XOR production XOR test)
- CSS strategy selection is priority-ordered: Lightning CSS (100) > Purge (50) > Minification (10)
- Vendor cache keys are deterministic: same inputs always produce same key (dependency order normalized via sort)
- Route chunk manifest version is always "1.0"; build manifest version is always "2.0.0"
