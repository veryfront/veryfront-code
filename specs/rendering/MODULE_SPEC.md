# NLSpec: src/rendering/

## Purpose

The rendering module is the SSR (Server-Side Rendering) engine for the Veryfront platform. It orchestrates the complete lifecycle of rendering user project pages: resolving which page file to render, collecting and applying nested layouts, compiling MDX/TSX/JS source files, performing React SSR (string or streaming), generating full HTML documents with metadata/styles/scripts, and caching results across multiple tiers (memory, filesystem, KV, Redis, API). The module supports multi-tenant operation where a single shared renderer instance handles requests for many projects with tenant-isolated caching, per-project concurrency limits, and singleflight deduplication.

## Public API

### Exports (from `index.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `VeryfrontRenderer` | class | Standalone renderer for single-project use (CLI builds, local dev) |
| `createRenderer(options)` | async factory | Creates and initializes a `VeryfrontRenderer` |
| `RendererOptions` | type | Options for `VeryfrontRenderer` constructor |
| `RenderResult` | type | Result of page rendering (html, frontmatter, headings, stream, etc.) |
| `PageDataResponse` | type | SPA navigation data (page metadata without full HTML) |
| `analyzeProjectChunks` | function | Analyzes MDX import graphs for chunk optimization suggestions |
| `generateChunkManifest` | function | Produces a chunk manifest from analysis results |
| `CacheCoordinator` | class | Multi-tier cache coordinator with TTL and project isolation |
| `CacheStore` | interface | Backend store contract (get/set/delete/clear/destroy) |
| `CachePayload` | type | Serialized render result for caching |
| `APICacheStore` | class | HTTP API-backed cache store |
| `FilesystemCacheStore` | class | Local filesystem cache store |
| `KVCacheStore` | class | Deno KV-backed cache store |
| `MemoryCacheStore` | class | LRU in-memory cache store |
| `RedisCacheStore` | class | Redis-backed cache store |
| `applyLayoutsESM` | function | Apply layout wrapping via ESM module loading |
| `applyLayoutsFunctionBody` | function | Apply layout wrapping via function body evaluation |
| `clearLayoutDiscoveryCache` | function | Invalidate layout discovery cache |
| `compileMDXLayouts` | function | Compile MDX layout files |
| `computeDepsHash` | function | Hash layout dependency tree |
| `discoverNestedLayouts` | function | Find nested layout files for a page |
| `renderSnippet` | function | Render an inline MDX snippet to HTML |
| `getCompiledSnippet` | function | Retrieve a cached compiled snippet by hash |
| `SnippetRenderOptions` | type | Options for snippet rendering |
| `SnippetRenderResult` | type | Result of snippet rendering |

### Key Internal Exports (not in barrel, imported directly by path)

| Export | From | Description |
|--------|------|-------------|
| `Renderer` | `renderer.ts` | Multi-tenant shared renderer (production server) |
| `initializeRenderer` / `getRenderer` / `destroyRenderer` | `renderer.ts` | Singleton management for shared renderer |
| `renderPage` | `renderer.ts` | Convenience function combining context creation + render |
| `createRenderContext` | `context/render-context.ts` | Build a RenderContext from HandlerContext |
| `setupSSRGlobals` | `ssr-globals/index.ts` | Install browser API stubs for SSR |
| `detectAppRouter` | `router-detection.ts` | Detect app vs pages router from directory structure |
| `clearRendererCacheForProject` | `renderer.ts` | Per-project cache invalidation |
| `RSCRenderer` | `rsc/server-renderer/index.ts` | React Server Components renderer |
| `buildClientManifest` | `rsc/component-analyzer.ts` | Build RSC client component manifest |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `react`, `react-dom/server` | esm.sh | React SSR rendering |
| `#veryfront/transforms/mdx` | transforms module | MDX compilation pipeline |
| `#veryfront/modules/react-loader` | modules | Component loading and SSR module transforms |
| `#veryfront/platform/adapters` | platform | Runtime adapter for filesystem abstraction |
| `#veryfront/config` | config | Project configuration loading |
| `#veryfront/html` | html | HTML shell generation and metadata injection |
| `#veryfront/errors` | errors | Structured error types (RENDER_ERROR, FILE_NOT_FOUND) |
| `#veryfront/observability/tracing` | observability | OpenTelemetry span instrumentation |
| `#veryfront/cache` | cache | Cache key building, distributed cache backends |
| `#veryfront/utils` | utils | Logging, hashing, LRU cache, path utilities |
| `esbuild` | npm | Script page transpilation |

## Behaviors

### Behavior 1: Full Page Render (Renderer.renderPage)
- **Given**: An initialized Renderer and a valid RenderContext
- **When**: `renderPage(slug, ctx, options)` is called
- **Then**: The pipeline resolves the page file, collects layouts, compiles content, performs SSR, generates HTML, and returns a `RenderResult` with html/frontmatter/headings
- **Edge cases**:
  - Cache hit returns immediately without rendering
  - Singleflight deduplicates concurrent renders of the same page
  - Per-project concurrency limit (default ceil(MAX/3)) rejects with 503 when exceeded
  - Global semaphore (default 30) rejects with 503 when pod capacity exhausted
  - Pipeline timeout (default 60s) aborts long-running renders
  - Requests with Authorization/Cookie headers bypass caching

### Behavior 2: Page Resolution
- **Given**: A slug like "blog/hello" and a project directory
- **When**: PageResolver.resolvePage() is called
- **Then**: It checks app router first (app/blog/hello/page.{mdx,tsx,...}), then pages router (pages/blog/hello.{mdx,tsx,...}), including dynamic segments ([id], [...slug])
- **Edge cases**: Router type can be forced via config.router = "app" | "pages"; auto-detection checks directory structure

### Behavior 3: Layout Collection and Application
- **Given**: A resolved page entity
- **When**: LayoutOrchestrator.collectLayouts() + applyLayoutsAndWrappers() are called
- **Then**: Nested layouts are discovered by walking up the directory tree, compiled (MDX) or loaded (TSX), and wrapped around the page element from innermost to outermost
- **Edge cases**: Dot-prefixed paths (.veryfront) skip layout collection; layout modules are preloaded in parallel

### Behavior 4: MDX Page Rendering
- **Given**: A .mdx or .md page file
- **When**: handleMDXPage() is called
- **Then**: Content is compiled to server-side code, loaded as ESM module, metadata extracted (frontmatter + generateMetadata), and a React element is created
- **Edge cases**: Precompiled module code can be passed to skip browser bundle compilation

### Behavior 5: Component Page Rendering (TSX/JSX)
- **Given**: A .tsx or .jsx page file
- **When**: handleComponentPage() is called
- **Then**: Source is read, transformed for client hydration (cached by content hash), loaded via SSR module loader, and a React element is created with the default export
- **Edge cases**: Missing default export throws RENDER_ERROR; component hydration cache uses LRU with 5000 max entries

### Behavior 6: Script Page Rendering (TS/JS)
- **Given**: A .ts or .js page file
- **When**: handleScriptPage() is called
- **Then**: Module is loaded (direct import for local files, esbuild transpilation for adapter-sourced files), executed with PageContext, and output is wrapped in HTML shell
- **Edge cases**: Output can be string HTML, Response object, or {html, frontmatter} object; full HTML documents get metadata injection instead of shell wrapping

### Behavior 7: Multi-Tier Caching
- **Given**: A render result and a cache key
- **When**: CacheCoordinator.persistResult() is called
- **Then**: Result is stored in the configured backend with TTL and project-prefixed keys
- **Edge cases**: Stream results are never cached; expired entries are evicted on read; nodeMap is serialized as entries array for JSON stores

### Behavior 8: SSR Rendering
- **Given**: A valid React element
- **When**: SSRRenderer.renderToHTML() is called
- **Then**: It selects string or streaming SSR based on React version and mode, renders the element, and returns HTML + optional stream
- **Edge cases**: Compiled binaries force string rendering (no streaming); pipeable streams (React 18) are converted to ReadableStream

### Behavior 9: Snippet Rendering
- **Given**: Inline MDX content
- **When**: renderSnippet() is called
- **Then**: Content is compiled, cached (local + distributed), loaded as ESM module, rendered to HTML, wrapped in an HTML shell with HMR support
- **Edge cases**: Distributed cache failures fall back to memory; render errors produce styled error HTML instead of throwing

### Behavior 10: SSR Browser Globals
- **Given**: Server-side environment without browser APIs
- **When**: setupSSRGlobals() is called
- **Then**: Minimal stubs for window, document, navigator, localStorage, etc. are installed on globalThis to prevent crashes in browser-dependent libraries
- **Edge cases**: Idempotent (no-op if already active); skipped if real window/document exist

### Behavior 11: Data Fetching
- **Given**: A page/layout module with getServerData or getStaticData exports
- **When**: RenderPipeline.resolveDataFetching() runs
- **Then**: Modules are loaded in parallel, data fetching functions are called with DataContext (params, query, request, url), and results are merged into page/layout props
- **Edge cases**: Page module failures are critical (throw); layout module failures are non-critical (warn and continue); notFound results throw FILE_NOT_FOUND; redirect results throw RENDER_ERROR with redirect context

### Behavior 12: Concurrency Control
- **Given**: Multiple concurrent render requests
- **When**: Renders are submitted to the shared Renderer
- **Then**: A global semaphore limits total concurrent renders (default 30), per-project mutexes limit per-tenant concurrency (default ceil(30/3)=10), and requests exceeding limits receive 503 responses
- **Edge cases**: Mutex uses FIFO queue with 10s timeout; project mutexes are cleaned up when count reaches zero

## Constraints

- Public API signatures must not change (VeryfrontRenderer, createRenderer, cache stores, layout utilities, snippet renderer)
- All cache keys must be tenant-isolated in multi-tenant mode (projectId:contentSourceId:key)
- SSR globals must be idempotent and safe for concurrent use
- React version compatibility: React 17 (string only), React 18/19 (string + streaming)
- Compiled binary mode disables streaming SSR (no blob URL workers)

## Error Handling

- `RENDER_ERROR` for general rendering failures (compilation, module loading, SSR)
- `FILE_NOT_FOUND` for missing pages and notFound data results
- `SERVICE_OVERLOADED` (503) for concurrency limit exceeded
- `TimeoutError` for pipeline/module/data/SSR timeouts (hard throw)
- `StreamTimeoutError` with partial content for stream read timeouts
- `COMPILATION_ERROR` for MDX compilation failures
- All errors are wrapped with context (slug, projectId, path) for debugging
- Snippet rendering returns error HTML instead of throwing

## Side Effects

- `setupSSRGlobals()` modifies globalThis (window, document, navigator, etc.)
- Module loading writes transformed files to temp directories
- Cache stores persist data to memory, filesystem, KV, Redis, or HTTP API
- Distributed snippet cache is lazily initialized on first use
- Component hydration cache and snippet cache use global LRU caches
- Router detection cache, CSS candidate manifest cache, and route candidate cache are global Maps

## Performance Constraints

- Renderer initialization ~100ms (shared services, esbuild init)
- Per-request service creation ~1ms
- Render pipeline timeout: 60s (configurable via RENDER_TIMEOUT_MS)
- Module loading timeout: 10s
- Data fetching timeout: 15s
- SSR rendering timeout: 20s
- CSS generation timeout: 5s (soft, returns undefined on timeout)
- Max concurrent renders per pod: 30 (configurable via RENDER_MAX_CONCURRENT)
- Max concurrent renders per project: ceil(MAX/3) (configurable via RENDER_PER_PROJECT_LIMIT)
- Semaphore acquire timeout: 5s

## Invariants

- A Renderer must be initialized before any render call (enforced by runtime check)
- SharedServices must be initialized before per-request services can access them
- Cache keys are always prefixed with project scope in multi-tenant mode
- Stream results are never cached (only string HTML)
- Per-project render count is always >= 0 and cleaned up to zero on last release
- Singleflight ensures at most one in-flight render per (projectId:environment:contentSourceId:slug:colorScheme) tuple
- CompilerService must have compileMDX set before any compilation call
