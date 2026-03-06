# NLSpec: src/modules/

## Purpose

The modules system handles dynamic ESM module loading, resolution, and React component discovery for the Veryfront platform. It provides import map management (loading, merging, resolving, transforming), a component registry for discovering and tracking React components in project directories, SSR module loading with multi-layer caching (memory, disk, Redis), path resolution, temp file management, concurrency control, and an HTTP module server that transforms and serves ESM modules at `/_vf_modules/*` URLs. The system supports both local development and multi-tenant production deployment across Kubernetes pods.

## Public API

### Exports (from `src/modules/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `ComponentRegistry` | class | Discovers, loads, and tracks React components from project directories |
| `ComponentExports` | type | Shape of a component module's exports (`{ default?, [key]: unknown }`) |
| `ComponentInfo` | type | Metadata for a discovered component (name, path, content, isLoaded, exports) |
| `ComponentRegistryOptions` | type | Options for constructing a ComponentRegistry |
| `clearImportMapCache` | function | Clears cached import maps (all or by project directory) |
| `getDefaultImportMap` | function | Returns default import map with Veryfront SSR and React mappings |
| `ImportMapConfig` | type | Shape of an import map (`{ imports?, scopes? }`) |
| `loadImportMap` | function | Loads and merges import maps from defaults, deno.json, and project config |
| `mergeImportMaps` | function | Merges multiple import maps with later maps taking precedence |
| `preloadImportMap` | function | Eagerly loads and caches an import map for a project directory |
| `resolveImport` | function | Resolves a specifier against an import map (scoped and global) |
| `transformImportsWithMap` | function | Rewrites import specifiers in source code using an import map |
| `TransformOptions` | type | Options for import transform (`{ resolveBare? }`) |
| `clearSSRModuleCache` | function | Clears all SSR module caches (memory, failed components, semaphore) |
| `clearSSRModuleCacheForProject` | function | Clears SSR module cache entries for a specific project |
| `ComponentMap` | type | Record mapping component names to React component types |
| `ComponentSource` | type | Source code input for unified loader (`{ name, source, filePath }`) |
| `getGlobalTmpDir` | function | Returns global temp directory for module files |
| `getProjectTmpDir` | function | Returns project-specific temp directory for module files |
| `loadComponentFromSource` | function | Loads a React component from source code (SSR or client-side) |
| `LoadComponentOptions` | type | Options for component loading (projectId, ssr, dev, reactVersion, etc.) |
| `loadComponentsUnified` | function | Batch-loads multiple components via temp entry point |
| `normalizeModulePath` | function | Converts `.tsx/.ts/.jsx` extensions to `.js` |
| `resetGlobalTmpDir` | function | Resets cached temp directory paths |
| `resolveRelativePath` | function | Strips project directory prefix from file paths |
| `ModuleResolver` | class | Resolves module specifiers to file paths, virtual modules, or CDN URLs |
| `ModuleResolverOptions` | type | Options for ModuleResolver (projectDir, importMap, virtualModules, adapter) |
| `ResolvedModule` | type | Result of resolution (`{ path, type, content?, transformed? }`) |

### Exports (from `src/modules/server/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `APIServer` | class | Handles `/_veryfront/data/*` requests for page data JSON |
| `APIServerOptions` | type | Options with a `PageRendererLike` renderer |
| `PageRendererLike` | type | Interface for page rendering (`renderPage(slug)`) |
| `PageRenderResult` | type | Result shape (`{ html, frontmatter, headings? }`) |
| `isModuleRequest` | function | Tests if a request URL matches `/_vf_modules/` or `/_veryfront/modules/` |
| `serveModule` | function | Serves transformed ESM modules with security, SSR, and HMR support |
| `ModuleServerOptions` | type | Options for module serving (projectDir, adapter, dev, branch, etc.) |
| `RateLimiter` | class | WebSocket message rate limiter for HMR connections |
| `setupWebSocketHandlers` | function | Sets up HMR WebSocket event handlers |
| `closeAllConnections` | function | Gracefully closes all HMR WebSocket connections |

### Exports (from `src/modules/manifest/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `startModuleCollection` | function | Begins tracking module loads for a request |
| `recordModuleLoad` | function | Records a module load during a request |
| `finishModuleCollection` | function | Finalizes module collection into a route manifest |
| `getRouteManifest` | function | Gets the full manifest for a project/route |
| `getRouteModulePaths` | function | Gets ordered module paths for a route |
| `getCriticalModulePaths` | function | Gets critical module paths for a route |
| `recordSSRModules` | function | Records SSR-discovered modules into manifest |
| `generateModulePreloadHintsFromManifest` | function | Generates `<link rel="modulepreload">` HTML hints |
| `getManifestStats` | function | Returns aggregate manifest statistics |
| `clearProjectManifests` | function | Clears manifests for a specific project |
| `clearAllManifests` | function | Clears all manifests |

### Exports (from `src/modules/loader-shared/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `JSX_IMPORT_PATTERN` | RegExp | Matches `import ... from "file://....(js|jsx|ts|tsx)"` |
| `REACT_IMPORT_PATTERN` | RegExp | Detects React imports |
| `PROJECT_ALIAS_IMPORT_PATTERN` | RegExp | Matches `@/` alias imports |
| `MODULE_SERVER_IMPORT_PATTERN` | RegExp | Matches `/_vf_modules/` imports |
| `VF_MODULE_IMPORT_PATTERN` | RegExp | Matches `/_vf_modules/` imports with optional `file://` prefix |
| `UNRESOLVED_VF_MODULES_PATTERN` | RegExp | Matches unresolved `_vf_modules` imports |
| `RELATIVE_IMPORT_PATTERN` | RegExp | Matches `./` and `../` imports |
| `STATIC_IMPORT_PATTERN` | RegExp | Matches static `import` statements |
| `DYNAMIC_IMPORT_PATTERN` | RegExp | Matches `import("...")` expressions |
| `EXPORT_FROM_PATTERN` | RegExp | Matches `export ... from "..."` |
| `MODULE_EXTENSIONS` | tuple | `[".tsx", ".ts", ".jsx", ".js", ".mdx"]` |
| `escapeRegExp` | function | Escapes special regex characters in a string |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `RuntimeAdapter` | `#veryfront/platform/adapters/base.ts` | Filesystem abstraction for cross-runtime compat |
| `transformToESM` | `#veryfront/transforms/esm/index.ts` | JSX/TSX to ESM compilation |
| `parseLocalImports` | `#veryfront/transforms/esm/import-parser.ts` | Extract local/cross-project imports from source |
| `getConfig` | `#veryfront/config` | Load project configuration |
| `getReactImportMap` | `#veryfront/transforms/esm/package-registry.ts` | React version-specific import mappings |
| `createSecureFs` | `#veryfront/security` | Sandboxed filesystem for module serving |
| `LRUCache` | `#veryfront/utils/lru-wrapper.ts` | Bounded caches to prevent memory leaks |
| `withSpan` | `#veryfront/observability/tracing/otlp-setup.ts` | Distributed tracing instrumentation |
| `createError, toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `CacheBackends` | `#veryfront/cache/backend.ts` | Redis distributed cache gateway |
| `hashCodeHex` | `#veryfront/utils/hash-utils.ts` | Fast content hashing |
| `injectNodePositions` | `#veryfront/transforms/plugins/babel-node-positions.ts` | JSX node position injection for dev/preview |
| `AsyncLocalStorage` | `node:async_hooks` | Request-scoped CSS import collection |

## Behaviors

### Behavior 1: Module Resolution (ModuleResolver)
- **Given**: A `ModuleResolver` constructed with a project directory, optional import map, and optional virtual modules
- **When**: `resolve(specifier, referrer?)` is called
- **Then**: Returns a `ResolvedModule` with type `virtual` (if specifier matches a virtual module), `external` (if import map maps to HTTP URL), `file` (if relative/absolute path resolves to existing file), or `npm` (if bare specifier, mapped to `https://esm.sh/{specifier}`)
- **Edge cases**: Path traversal via `/../` is blocked (returns null). Extension probing tries `""`, `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`. Results are cached in LRU. Virtual modules with empty string content still resolve.

### Behavior 2: Import Map Loading
- **Given**: A project directory path and optional runtime adapter
- **When**: `loadImportMap(startPath, adapter?)` is called
- **Then**: Loads import maps from three sources (default framework map, deno.json walking up directory tree, project config) and merges them with later sources taking precedence. Normalizes `npm:` specifiers to `esm.sh` URLs. Filters out relative paths from deno.json (they are for Deno's native resolution, not browser/SSR). Overrides React mappings to ensure single React instance.
- **Edge cases**: Missing deno.json is silently skipped. Malformed JSON is silently skipped (falls back to defaults). Virtual filesystems only check project root (no directory walking).

### Behavior 3: Import Map Resolution
- **Given**: An import map config with `imports` and optional `scopes`
- **When**: `resolveImport(specifier, importMap, scope?)` is called
- **Then**: Checks scoped exact match first, then global exact match. For esm.sh URLs, extracts package name and checks for package-level mapping. For `.js`/`.mjs`/`.cjs` specifiers, tries stripping extension. For prefix mappings (keys ending with `/`), applies path suffix substitution. Returns specifier unchanged if no mapping found.

### Behavior 4: Import Map Merging
- **Given**: Multiple `ImportMapConfig` objects
- **When**: `mergeImportMaps(...maps)` is called
- **Then**: Merges `imports` with `Object.assign` (later wins). Merges `scopes` per scope key with `Object.assign` per scope.

### Behavior 5: Component Registry Discovery
- **Given**: A `ComponentRegistry` with a project directory and component directories (default: `components`, `islands`, `src/components`, `src/islands`)
- **When**: `discover()` is called
- **Then**: Recursively walks each directory, registering `.tsx` and `.jsx` files by their base name (without extension). Skips `node_modules`, `.test.`, `.spec.` files, and `index` files. Missing directories are silently skipped.
- **Edge cases**: Duplicate component names across directories: last one wins. Components with special characters, numbers, or long names are supported. Concurrent `discover()` calls are safe. `loadComponent()` before `discover()` returns null.

### Behavior 6: SSR Module Loading (SSRModuleLoader)
- **Given**: An `SSRModuleLoader` with project options (projectDir, projectId, contentSourceId, adapter, dev)
- **When**: `loadModule(filePath, source)` is called
- **Then**: Checks circuit breaker (throws if component has failed repeatedly within cooldown). Transforms source with dependencies recursively (max depth 15, batch size 10). Uses multi-layer cache: memory LRU -> Redis distributed cache -> MDX-ESM cache -> fresh transform. Injects node positions for JSX files in dev/preview mode. Rewrites local imports, cross-project imports, and `/_vf_modules/` imports to `file://` temp paths. Validates HTTP bundles exist. Extracts component from module (prefers `default` export, falls back to first named export).
- **Edge cases**: Concurrent requests for same file coalesce via in-progress promise map. In-progress transforms that timeout (30s) are retried. Cache invalidation on "Cannot find module" errors. Circuit breaker opens after 3 failures, resets after 60s. Per-project transform limits prevent noisy-neighbor issues (1/3 of global capacity). Projects with `__single__` ID or `local-` prefix bypass rate limiting.

### Behavior 7: Cross-Project Import Loading
- **Given**: A cross-project import specifier like `@acme/ui@1.0.0/@/components/Button.tsx`
- **When**: The SSR loader encounters it during dependency resolution
- **Then**: Checks global cross-project cache first. If miss, fetches source from registry URL (`{apiBaseUrl}/{projectSlug}@{version}/@/{path}`), transforms it, writes to temp file, and caches the result. Injects trace context headers for observability.

### Behavior 8: Module Server (serveModule)
- **Given**: An HTTP request to `/_vf_modules/*` or `/_veryfront/modules/*`
- **When**: `serveModule(req, options)` is called
- **Then**: Determines module type (snippet, cross-project, framework file, project file). Finds source file with extension probing (`.tsx`, `.ts`, `.jsx`, `.js`, `.mdx`, `.md`, plus `.src` variants for compiled binaries). Transforms source to ESM. Applies SSR import rewrites for Deno/SSR requests. Injects HMR timestamps. Returns JavaScript with `no-cache` headers. Embedded polyfills are served without filesystem I/O for compiled binaries.
- **Edge cases**: HEAD requests return empty body. Security validation via `createSecureFs`. Framework files are looked up from multiple locations (embedded sources, framework root, project dir). Returns `// Transform Error` as JavaScript for transform failures.

### Behavior 9: Module Batch Handler
- **Given**: A batch request to `/_vf_modules/_batch?paths=a.js,b.js`
- **When**: `handleModuleBatch(req, options)` is called
- **Then**: Validates paths (non-empty, max 100). Loads and transforms each module concurrently. Generates a JavaScript bundle with `__vf_batch_modules` Map and `getModule()` accessor. Caches transforms in non-dev mode (LRU, 1000 entries). Reports slow requests (>500ms) and slow transforms (>100ms).

### Behavior 10: Route Module Manifest
- **Given**: Module loads during page rendering
- **When**: `startModuleCollection` / `recordModuleLoad` / `finishModuleCollection` are called
- **Then**: Tracks modules per route per project. Merges new modules with existing manifest. Generates `<link rel="modulepreload">` hints. Supports critical module prioritization.

### Behavior 11: CSS Import Collection
- **Given**: SSR module loading encountering CSS imports
- **When**: `runWithCSSCollector(fn)` wraps module loading
- **Then**: CSS import paths are collected via `AsyncLocalStorage` for request-scoped isolation. `registerCSSImport()` is a no-op outside collector context.

### Behavior 12: HMR WebSocket Handling
- **Given**: A WebSocket connection for HMR
- **When**: `setupWebSocketHandlers(socket, context)` is called
- **Then**: Sends "connected" message with reactRefresh flag. Rate-limits incoming messages (configurable max per window). Rejects oversized messages. Responds to "ping" with "pong". Cleans up on close/error.

### Behavior 13: Import Map Preloading
- **Given**: A project directory and runtime adapter
- **When**: `preloadImportMap(projectDir, adapter)` is called
- **Then**: Eagerly loads and caches the import map. Subsequent calls return the cached promise. Failed loads are evicted from cache.

## Constraints

- SSR module cache is bounded: 500 entries for module pointers, 100 for temp dirs, 2000 for HTTP bundle verification.
- Maximum transform depth is 15 (prevents circular dependency loops).
- Maximum concurrent ESM transforms is configurable (default 50, via `SSR_MAX_CONCURRENT_TRANSFORMS` env var).
- Per-project transform limit defaults to ceil(max/3) to prevent noisy-neighbor monopolization.
- Module batch requests are limited to 100 paths per request.
- Transform slot acquisition times out after 500ms.
- In-progress transform wait times out after 30s.

## Error Handling

- **Circuit breaker**: Components that fail 3+ times within 60s are temporarily blocked with a structured build error.
- **Missing dependencies**: Accumulated across the transform tree and reported as a structured build error with all missing specifiers.
- **Path traversal**: Silently returns null (no error thrown) from `ModuleResolver`.
- **Transform capacity exceeded**: Throws structured build errors with diagnostic context.
- **Cache file missing**: Invalidates cache entry and throws structured build error.
- **HTTP bundle recovery**: Attempts recovery by hash; if recovery fails, invalidates cache and throws.

## Side Effects

- **Filesystem writes**: Temp files written to cache directories for SSR module loading.
- **Redis writes**: Transformed code stored in distributed cache for cross-pod sharing (fire-and-forget, errors logged at debug level).
- **Global state**: Multiple module-level `Map` and `LRUCache` instances (globalModuleCache, globalTmpDirs, globalInProgress, failedComponents, manifestStore, importMapCache, transformCache).
- **Cache registration**: Caches registered with monitoring system via `registerCache()` and `registerMapCache()`.

## Performance Constraints

- Content hashing uses fast `hashCodeHex` for content < 10KB, SHA-256 for larger content.
- Transform results are cached at multiple levels (memory LRU -> Redis -> disk).
- Module batch handler reduces HTTP overhead from hundreds of requests to 5-10 batch requests.
- Import map resolution is O(1) hash lookup for exact matches, O(n) scan for prefix matches.
- Concurrent transforms are bounded by semaphore to prevent resource exhaustion.

## Invariants

- A single React instance is always enforced: React import map entries are applied last in `normalizeImportMapForRuntime()`.
- Content-addressed caching: same source content always produces the same cache key (version + projectId + contentSourceId + reactVersion + configHash + filePath + contentHash).
- Cache keys include framework VERSION to invalidate on upgrades.
- SSR module cache entries are invalidated when their temp files no longer exist on disk.
- The `contentSourceId` is required for SSR module cache operations (enforced by throwing).
- Per-project rate limit bypass for `__single__` and `local-` prefixed project IDs ensures local development is never throttled.
