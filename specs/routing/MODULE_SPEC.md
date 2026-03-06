# NLSpec: src/routing/

## Purpose

File-system routing module that provides dynamic route matching (URL-to-page resolution), slug/path mapping for both App Router and Pages Router patterns, API route handling with CORS/cookie/OpenAPI support, module loading with esbuild transpilation, client-side SPA navigation utilities (prefetching, page transitions, scroll restoration), and a priority-based route handler registry. It is the core routing backbone shared between the renderer (page matching), the API server (handler dispatch), and the browser client (SPA navigation).

## Public API

### Exports (from `src/routing/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `Route` | interface | Route definition with pattern, page, optional regex/params |
| `RouteMatch` | interface | Match result containing params and matched route |
| `DynamicRouter` | class (deprecated alias) | Alias for `PageRouteMatcher` -- specificity-based page route matcher |
| `getSpecificityScore` | function | Computes route priority score (static > dynamic > catch-all) |
| `matchRoute` | function | Tests a pathname against a compiled route regex, extracts params |
| `normalizePath` | function (re-export) | Normalizes URL paths (strips trailing slash, lowercases) |
| `parseRoute` | function | Compiles a pattern string into a Route with regex and param names |
| `PathCandidates` | interface | App Router + Pages Router file path candidates |
| `RouteParams` | interface | Extracted route parameters (string or string[]) |
| `extractParams` | function | Extracts params from pattern/slug pair (slug-mapper) |
| `getPathCandidates` | function | Generates file path candidates for a slug in both router modes |
| `getSlugFromPath` | function | Extracts slug from a file path (strips extension, index/page names) |
| `getSupportedExtensions` | function | Returns supported page file extensions |
| `isDynamicRoute` | function (re-export) | Tests if a route pattern contains dynamic segments |
| `matchesPattern` | function | Tests if a slug matches a route pattern |
| `normalizeSlug` | function | Normalizes slug by splitting/rejoining on `/` |
| `pathToSlug` | function | Converts URL path to slug (strips leading `/`) |
| `slugToPath` | function | Converts slug to URL path (prepends `/`) |
| `RouteData` | interface | Page HTML + frontmatter + component data for client navigation |
| `SpaPageData` | interface | Full SPA page metadata (slug, layouts, providers, params) |
| `extractPageDataFromScript` | function | Parses page data from inline `<script data-veryfront-page>` |
| `NavigationHandlers` | class | Click/popstate/hover event handlers for SPA navigation |
| `PageLoader` | class | Cached page data fetcher with JSON-first, HTML-fallback strategy |
| `PageTransition` | class | Animated DOM transitions with head management and scroll handling |
| `ViewportPrefetch` | class | IntersectionObserver-based link prefetching |
| `APIContext` | interface | Request context passed to Pages Router API handlers |
| `APIHandler` | type | Function signature for API route handlers |
| `APIResponse` | interface | API response shape (body, status, headers) |
| `APIRoute` | interface | Module export shape for API route files |
| `APIRouteHandler` | class | Full API route handler -- discovery, matching, loading, CORS |
| `applyCORSHeaders` | function (re-export) | Applies CORS headers to a response |
| `badRequest` | function (re-export) | Returns 400 response |
| `createContext` | function | Builds APIContext from request + route match |
| `forbidden` | function (re-export) | Returns 403 response |
| `handleCORSPreflight` | function (re-export) | Handles OPTIONS preflight requests |
| `json` | function (re-export) | Returns JSON response |
| `normalizeParams` | function | Flattens array params to string (joins with `/`) |
| `notFound` | function (re-export) | Returns 404 response |
| `parseCookies` | function (re-export) | Parses cookie header string |
| `redirect` | function (re-export) | Returns redirect response |
| `serverError` | function (re-export) | Returns 500 response |
| `unauthorized` | function (re-export) | Returns 401 response |

### Submodule: `api/openapi/`

| Export | Type | Description |
|--------|------|-------------|
| `createRoute` | function | Wraps an API handler with OpenAPI metadata (Zod schemas) |
| `z` | re-export | Zod schema library |
| `extractPathParams` | function | Extracts path parameter info from route patterns |
| `generateOperationId` | function | Generates camelCase operation ID from method + path |
| `toOpenAPIPath` | function | Converts `[id]` patterns to `{id}` OpenAPI format |
| `generateOpenAPISpec` | function | Generates full OpenAPI 3.1.0 spec from discovered routes |
| `generateOpenAPIJson` | function | Generates spec as JSON string |
| `specToYaml` | function | Converts OpenAPI spec to YAML string |
| `createOpenAPIResource` | function | Creates MCP resource for the OpenAPI spec |
| `generateMCPToolsFromSpec` | function | Auto-generates MCP tools from OpenAPI spec |
| `registerOpenAPIMCP` | function | Registers OpenAPI spec as MCP resource + tools |
| `isOpenAPIMCPEnabled` | function | Checks if OpenAPI MCP integration is enabled in config |
| `OPENAPI_METADATA` | symbol | Symbol key for storing OpenAPI metadata on handlers |

### Submodule: `api/module-loader/`

| Export | Type | Description |
|--------|------|-------------|
| `createHTTPPlugin` | function | esbuild plugin for fetching HTTP URL imports with lockfile/integrity |
| `validateHTTPImports` | function | Validates HTTP imports against allowed host list |
| `loadHandlerModule` | function | Loads, transpiles, and evaluates API route modules |
| `loadSecurityConfig` | function | Loads allowed remote hosts from project config |

### Submodule: `registry/`

| Export | Type | Description |
|--------|------|-------------|
| `RouteRegistry` | class | Priority-ordered handler chain for request dispatch |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `#veryfront/utils` | internal | Logging, path normalization, cookie parsing, LRU cache |
| `#veryfront/config` | internal | Project configuration loading |
| `#veryfront/errors` | internal | Error creation and RFC 9457 error responses |
| `#veryfront/http/responses` | internal | HTTP response helpers (notFound, json, redirect, etc.) |
| `#veryfront/security` | internal | CORS handling, HTML sanitization, path validation |
| `#veryfront/platform/adapters` | internal | Runtime adapter (file system, env) |
| `#veryfront/observability` | internal | Distributed tracing (withSpan) |
| `#veryfront/compat/path` | internal | Cross-runtime path utilities |
| `esbuild` | external | TypeScript transpilation for API route modules |
| `zod` | external | Schema validation for OpenAPI route definitions |

## Behaviors

### Behavior 1: Page Route Matching (PageRouteMatcher / DynamicRouter)
- **Given**: Routes are registered with patterns like `/about`, `/blog/[slug]`, `/docs/[...path]`
- **When**: A URL pathname is matched via `match(pathname)`
- **Then**: Returns the most specific matching route with extracted params, or null
- **Edge cases**: Optional catch-all `[[...slug]]` matches the parent path without params; results are cached per pathname; routes are sorted by specificity on every `addRoute`

### Behavior 2: API Route Matching (ApiRouteMatcher)
- **Given**: API routes are registered with patterns (e.g., `/api/users/[id]`)
- **When**: A request pathname is matched
- **Then**: Returns the matching route with params, using LRU-cached results with optional TTL
- **Edge cases**: Trailing slashes are normalized; static routes take priority over dynamic; catch-all routes have lowest priority

### Behavior 3: Slug-to-Path Mapping
- **Given**: A URL slug (e.g., `blog/my-post`) and a project directory
- **When**: `getPathCandidates(projectDir, slug)` is called
- **Then**: Returns file path candidates for both App Router (`app/blog/my-post/page.{ext}`) and Pages Router (`pages/blog/my-post.{ext}`, `pages/blog/my-post/index.{ext}`)
- **Edge cases**: Empty/index slugs map to root; supported extensions: `.mdx`, `.md`, `.tsx`, `.jsx`, `.ts`, `.js`

### Behavior 4: Dynamic Route Parameter Extraction (slug-mapper)
- **Given**: A pattern like `blog/[slug]/[...rest]` and a slug like `blog/hello/a/b`
- **When**: `extractParams(pattern, slug)` is called
- **Then**: Returns `{ slug: "hello", rest: ["a", "b"] }` or null if no match
- **Edge cases**: Non-spread patterns require exact segment count; spread params consume all remaining segments

### Behavior 5: API Route Handler Lifecycle
- **Given**: An `APIRouteHandler` initialized with a project directory
- **When**: `initialize()` is called, then `handle(request)`
- **Then**: Discovers routes from `pages/api/` and `app/` directories; matches incoming requests; loads handler modules (with transpilation if needed); executes the correct HTTP method handler; applies CORS headers
- **Edge cases**: OPTIONS requests are handled as CORS preflight; HEAD requests fall back to GET handler; empty handler modules are not cached; App Router vs Pages Router detected by `route.ts` filename pattern

### Behavior 6: Module Loading and Transpilation
- **Given**: A TypeScript API route file path and a project directory
- **When**: `loadHandlerModule()` is called
- **Then**: In Deno with local files, directly imports TypeScript; otherwise, reads the file, validates HTTP imports against allowed hosts, bundles with esbuild (externalizing node builtins, user deps, framework packages), rewrites imports for the target runtime, writes to temp file, and dynamic-imports it
- **Edge cases**: Path traversal attacks are blocked; compiled Deno binaries use a CJS require shim; user npm deps are externalized (npm: specifiers in Deno, file:// URLs in Node); lockfile with integrity checking for HTTP imports

### Behavior 7: Client-Side SPA Navigation
- **Given**: A `NavigationHandlers` instance with navigation callbacks
- **When**: User clicks an internal link or browser back/forward is triggered
- **Then**: Intercepts the click, fetches new page data (JSON first, HTML fallback), performs a fade transition, updates `<head>` tags, restores scroll position for popstate, and manages focus
- **Edge cases**: External links, `target="_blank"`, `download` attributes bypass interception; scroll positions are capped at 100 entries (LRU); hover prefetch respects `data-prefetch` attribute; viewport prefetch uses IntersectionObserver with 200px root margin

### Behavior 8: Route Registry (Handler Chain)
- **Given**: Multiple handlers registered with priorities
- **When**: `execute(request, context)` is called
- **Then**: Handlers are tried in priority order; first handler returning a response wins; if a handler signals `continue: false` without a response, the chain stops; errors are converted to RFC 9457 responses
- **Edge cases**: Disabled handlers (via `metadata.enabled`) are skipped; handler timing is logged in debug mode

### Behavior 9: OpenAPI Spec Generation
- **Given**: A router with discovered API routes and optional Zod-annotated handlers
- **When**: `generateOpenAPISpec()` is called
- **Then**: Produces an OpenAPI 3.1.0 spec by loading each handler module, reading `OPENAPI_METADATA` from handlers, and building operations with parameters, request bodies, and responses
- **Edge cases**: Routes without `createRoute` metadata get generic summaries; default handlers fill all HTTP methods; tags are collected and deduplicated

### Behavior 10: OpenAPI MCP Integration
- **Given**: An OpenAPI spec and MCP configuration
- **When**: `registerOpenAPIMCP()` is called
- **Then**: Registers the spec as an MCP resource (cacheable) and generates callable MCP tools for each endpoint, with proper parameter schemas and end-user identity propagation
- **Edge cases**: Resource and tool registration can be independently disabled; API call errors return structured error objects rather than throwing

## Constraints
- Route patterns follow Next.js conventions: `[param]`, `[...spread]`, `[[...optional]]`
- Module loading validates all paths stay within the project directory (path traversal prevention)
- HTTP imports in API routes must come from allowed hosts (configurable via `security.remoteHosts`)
- Client-side HTML injection uses `validateTrustedHtml` for defense-in-depth

## Error Handling
- API route errors are converted to RFC 9457 (Problem Details) JSON responses
- Module loading failures produce descriptive errors with the original error message
- Blocked HTTP imports produce actionable remediation messages
- Client-side fetch failures show an error page with a reload button
- Failed prefetches are silently caught and logged as warnings

## Side Effects
- `APIRouteHandler.initialize()` reads the file system to discover route files
- `loadHandlerModule()` creates and deletes temporary files/directories
- `loadHandlerModule()` may fetch HTTP URLs (via esbuild plugin) with lockfile writes
- `registerOpenAPIMCP()` registers global MCP resources and tools
- Client-side classes modify the DOM (innerHTML, head tags, focus, scroll position)
- `RouteRegistry.execute()` emits tracing spans

## Performance Constraints
- `PageRouteMatcher` caches match results per pathname (Map)
- `ApiRouteMatcher` uses LRU cache with 500 entries and 5-minute TTL
- `APIRouteHandler` uses LRU cache (256 entries) for loaded handler modules
- `PageLoader` uses Map caches with 50-entry LRU eviction for both HTML and SPA data
- `NavigationHandlers` caps scroll position storage at 100 entries
- Route sorting happens on every `addRoute` call (acceptable for small route counts)

## Invariants
- A route pattern always produces a deterministic regex after parsing
- Static segments always have higher specificity than dynamic segments
- Catch-all params are always returned as string arrays, regular params as strings
- CORS preflight is always handled before route matching for OPTIONS requests
- Temp files created during module loading are always cleaned up (finally block)
- Handler modules must return `Response` instances (cross-context objects are normalized)
