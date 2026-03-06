# NLSpec: src/client/spa/

## Purpose

Client-side SPA module that dynamically loads React components from a module server at runtime, with caching and deduplication. Provides path-to-URL resolution utilities that convert source file paths (e.g., `pages/index.tsx`) into browser-loadable module URLs (e.g., `/_vf_modules/pages/index.js`).

## Public API

### Exports (via `index.ts`)
| Export | Type | Description |
|--------|------|-------------|
| `loadComponent` | function | Dynamically imports a React component by source path, with caching and in-flight deduplication |
| `preloadComponent` | function | Loads a component into the cache without returning it |
| `getCachedComponent` | function | Synchronously retrieves a previously loaded component from cache, or null |
| `clearComponentCache` | function | Clears both the component cache and any in-flight loading promises |
| `pathToModuleUrl` | function | Converts a source file path to a module server URL |
| `getModuleServerUrl` | function | Returns the module server base URL, reading from `globalThis.MODULE_SERVER_URL` when in browser |
| `getPathToModuleUrlScript` | function | Returns an inline JavaScript string implementing `pathToModuleUrl` for embedding in HTML hydration scripts |
| `ClientApp` | component | Re-exported from `ClientApp.tsx` (outside scope of analyzed files) |
| `PageDataResponse` | type | Re-exported from `ClientApp.tsx` (outside scope of analyzed files) |
| `LayoutInfo` | type | Re-exported from `LayoutShell.tsx` (outside scope of analyzed files) |
| `LayoutShell` | component | Re-exported from `LayoutShell.tsx` (outside scope of analyzed files) |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `ComponentType` | `react` | Type for cached React components |
| `pathToModuleUrl` | `./path-utils.ts` | Used by component-loader to resolve import URLs |

## Behaviors

### Behavior 1: Component loading with cache hit
- **Given**: A component at a given path has been previously loaded and cached
- **When**: `loadComponent(path)` is called with the same path
- **Then**: Returns the cached component immediately (synchronous resolve) without issuing a new dynamic import

### Behavior 2: Component loading with cache miss
- **Given**: No component is cached for the given path
- **When**: `loadComponent(path)` is called
- **Then**: Resolves the path to a module URL via `pathToModuleUrl`, dynamically imports the module, extracts the default export (falling back to the module itself), caches the result, and returns the component
- **Edge cases**: If the module has no `default` export, the entire module object is cached and returned as the component

### Behavior 3: In-flight deduplication
- **Given**: A `loadComponent(path)` call is already in progress (not yet resolved)
- **When**: Another `loadComponent(path)` is called with the same path
- **Then**: Returns the same promise, preventing duplicate network requests
- **Edge cases**: The in-flight promise is removed from the tracking map in the `finally` block, so subsequent calls after resolution will use the component cache instead

### Behavior 4: Component load failure
- **Given**: The dynamic import for a path fails (network error, module not found, etc.)
- **When**: `loadComponent(path)` is called
- **Then**: Logs an error to console with prefix `[Veryfront]`, returns `null`, and cleans up the in-flight promise (does NOT cache the failure)

### Behavior 5: Loading with empty path
- **Given**: An empty string is passed as the path
- **When**: `loadComponent("")` is called
- **Then**: Returns `null` immediately without attempting any import

### Behavior 6: Path resolution for known source directories
- **Given**: A path containing a recognized source directory (`pages`, `components`, `app`, `lib`, `layouts`, `shared`, `features`) with a source extension (`.tsx`, `.ts`, `.jsx`, `.mdx`)
- **When**: `pathToModuleUrl(path)` is called
- **Then**: Extracts the directory and file stem, replaces the extension with `.js`, and prepends the module server base URL
- **Edge cases**: Works for both absolute paths (e.g., `/project/pages/index.tsx`) and relative paths (e.g., `pages/index.tsx`). Absolute paths are matched first.

### Behavior 7: Path resolution for non-source-dir paths with known extension
- **Given**: A path that does not match a known source directory but has a known file extension (`.tsx`, `.ts`, `.jsx`, `.mdx`, `.js`, `.mjs`)
- **When**: `pathToModuleUrl(path)` is called
- **Then**: Replaces source extensions with `.js` (leaves `.js`/`.mjs` unchanged) and prepends the base URL

### Behavior 8: Path resolution for extensionless paths
- **Given**: A path with no recognized file extension
- **When**: `pathToModuleUrl(path)` is called
- **Then**: Appends `.js` and prepends the base URL

### Behavior 9: Module server URL resolution
- **Given**: Running in a browser environment
- **When**: `getModuleServerUrl()` is called
- **Then**: Returns `globalThis.MODULE_SERVER_URL` if set, otherwise falls back to `"/_vf_modules"`
- **Edge cases**: In non-browser environments (where `window` is `undefined`), always returns `"/_vf_modules"` without checking `globalThis.MODULE_SERVER_URL`

### Behavior 10: Inline script generation
- **Given**: The system needs to embed path resolution logic in an HTML hydration script
- **When**: `getPathToModuleUrlScript()` is called
- **Then**: Returns a self-contained JavaScript function string that mirrors the logic of `pathToModuleUrl`, using `MODULE_SERVER_URL` as the global base (not `getModuleServerUrl()`)

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/client/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: `deno fmt --check src/client/ && deno lint src/client/`

## Error Handling
- `loadComponent` catches all errors from dynamic `import()` calls, logs them via `console.error`, and returns `null` (never throws)
- Failed loads are NOT cached, allowing retry on subsequent calls

## Side Effects
- **Global registration**: On module load in browser environments, `component-loader.ts` attaches `loadComponent`, `preloadComponent`, and `getCachedComponent` to `window` as `__VERYFRONT_LOAD_COMPONENT__`, `__VERYFRONT_PRELOAD_COMPONENT__`, and `__VERYFRONT_GET_CACHED_COMPONENT__` respectively
- **Module-level state**: Two `Map` instances (`componentCache` and `loadingPromises`) persist for the lifetime of the module
- **Dynamic imports**: `loadComponent` performs network requests via `import()` to fetch JavaScript modules from the module server

## Performance Constraints
- Component cache and in-flight deduplication map ensure each module is fetched at most once
- Regex patterns for path resolution are precomputed at module level (not recreated per call)
- `getCachedComponent` is synchronous for use in render-critical paths

## Invariants
- A component at a given path is loaded from the network at most once (subsequent calls return cached result)
- The in-flight promise map is always cleaned up after resolution (success or failure), via the `finally` block
- `pathToModuleUrl` always returns a URL ending in `.js`
- The inline script from `getPathToModuleUrlScript` must produce identical output to `pathToModuleUrl` for all inputs
