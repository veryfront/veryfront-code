# NLSpec: src/server/

## Purpose

The Server module is the main HTTP server layer for Veryfront, providing both development and production server implementations. It orchestrates request handling through a modular handler pipeline, supports Hot Module Replacement (HMR) with file watching for development, manages per-project isolation and environment variable scoping in multi-tenant proxy mode, and handles domain-based project resolution for both custom domains and Veryfront subdomains. The module serves as the composition root that wires together routing, rendering, security, caching, and observability subsystems.

## Public API

### Exports (from `index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `startServer` | function | Primary entry point - starts dev or production server based on options |
| `createHandler` | function | Creates a runtime-agnostic `VeryfrontHandler` for use with any HTTP framework |
| `toNodeHandler` | function | Converts a Web API handler into a Node.js HTTP request listener |
| `DevServer` | class | Development server with HMR, file watching, middleware pipeline |
| `startDevServer` | function | Creates and starts a DevServer instance |
| `startProductionServer` | function | Starts a production server with graceful shutdown |
| `ReloadNotifier` | singleton | Global pub/sub for file change reload events (debounced + invalidation) |
| `StartServerOptions` | type | Union of dev/production mode options |
| `VeryfrontServer` | interface | Running server instance with ready/stop/port/url |
| `VeryfrontHandler` | type | Request handler with `upgrade` and `connectHMR` methods |
| `StartDevModeOptions` | interface | Dev server options (HMR, file watcher, etc.) |
| `StartProductionModeOptions` | interface | Production options (debug, discovery, local projects) |
| `BuildOptions` | type | Build configuration (splitting, compression, SSG) |
| `BuildStats` | type | Build output statistics |
| `DiscoveryOptions` | interface | AI primitives discovery configuration |
| `ServerHandle` | interface | Production server lifecycle handle (ready/stop) |
| `DevServerOptions` | interface | Dev server constructor options |
| `FileWatcherMetrics` | interface | File watcher performance statistics |
| `RouteDirectory` | interface | Route directory descriptor (app or pages type) |

### Sub-module Exports

| Barrel | Key Exports |
|--------|-------------|
| `handlers/index.ts` | `BaseHandler`, `CorsHandler`, `NotFoundHandler`, `HandlerPriority`, `getContentType`, handler types |
| `runtime-handler/index.ts` | `createVeryfrontHandler`, `parseProxyEnvironment`, `RouteRegistry`, `BaseHandler`, `HandlerContext` |
| `services/index.ts` | `SSRService`, `StaticFileService`, RSC handler exports |
| `context/index.ts` | `createRequestContext`, `getCacheStrategy`, `shouldEnableCache`, `RequestContext` |
| `shared/index.ts` | `getRendererForProject`, `destroyRendererAdapter`, `shouldRejectDueToMemory`, `RendererAdapter` |
| `schemas/index.ts` | `ActionPayloadSchema`, `ActionPayload` |
| `project-env/index.ts` | `runWithProjectEnv`, `getProjectEnv`, `isProjectEnvActive`, `EnvironmentVariableCache`, `fetchProjectEnvVars` |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `RuntimeAdapter` | `#veryfront/platform/adapters/base.ts` | Runtime abstraction (Deno/Node/Bun) |
| `VeryfrontConfig` | `#veryfront/config` | Project configuration loading |
| `RouteRegistry` | `#veryfront/routing/registry` | Handler registration and execution pipeline |
| `SecurityConfigLoader` | `#veryfront/security/http/config.ts` | Security configuration (CSP, CORS, CSRF) |
| `MiddlewarePipeline` | `#veryfront/middleware/core/pipeline` | Dev server middleware execution |
| `DynamicRouter` | `#veryfront/routing/api` | Route discovery and matching |
| `ComponentRegistry` | `#veryfront/modules/component-registry` | Component discovery |
| OTLP tracing | `#veryfront/observability/tracing` | Distributed tracing |
| `serverLogger` | `#veryfront/utils` | Structured logging |
| `RateLimiter` | `#veryfront/modules/server` | WebSocket rate limiting |
| `AsyncLocalStorage` | `node:async_hooks` | Per-request env var isolation |
| `esbuild` | `esbuild` | Dev bundling and middleware transpilation |
| zod | `zod` | Action payload validation |

## Behaviors

### Behavior 1: Development Server Startup

- **Given**: A project directory with optional `app/` or `pages/` directories
- **When**: `startServer({ mode: "development" })` or `startDevServer()` is called
- **Then**: The server bootstraps the runtime adapter, loads `.env` files, discovers routes and components, sets up file watchers (if HMR enabled), creates a middleware pipeline (CORS, user middleware, request handler), discovers AI primitives, and starts listening on the configured port
- **Edge cases**: Proxy mode skips file watchers, component discovery, and route discovery; multi-project directories (no app/pages but has projects/) don't get a default project slug

### Behavior 2: Production Server Startup with Graceful Shutdown

- **Given**: A production deployment (standalone or proxy mode)
- **When**: `startProductionServer()` is called or `production-server.ts` runs as main
- **Then**: The server initializes OTLP tracing, distributed caches, bootstraps with FSAdapter, enables SSR fetch interception, runs AI discovery, creates the handler with RouteRegistry, starts serving, and registers SIGINT/SIGTERM handlers for graceful drain (25s default)
- **Edge cases**: `NODE_ENV` must be set to `production` in proxy mode (PROXY_MODE=1); OTLP and cache failures are non-fatal; requests in-flight during shutdown are drained with timeout

### Behavior 3: Request Handling Pipeline

- **Given**: An incoming HTTP request to the runtime handler
- **When**: `createVeryfrontHandler()` processes the request
- **Then**: The handler extracts request headers, starts lifecycle tracking and tracing, checks project isolation (circuit breaker + concurrency), resolves the project (headers > domain > config > API lookup), resolves the adapter (local vs proxy), resolves environment (preview/production), builds handler context with enriched project info, fetches per-project env vars (if proxy mode), and executes the route registry with timeout protection
- **Edge cases**: Monitoring paths (`/healthz`, `/readyz`, `/_metrics`) take a fast path skipping domain resolution; vulnerability scanner probes are rejected early; WebSocket upgrades bypass request interceptors; missing `x-project-slug` or `x-token` in proxy mode returns 502

### Behavior 4: Project Resolution

- **Given**: A request with various project identification sources
- **When**: `resolveProject()` is called
- **Then**: Project is resolved with priority: request headers (x-project-slug) > WebSocket query param > config file > domain parsing (*.veryfront.com) > API domain lookup (custom domains)
- **Edge cases**: Custom domains trigger API lookup with timeout (10s); results cached with 60s TTL and request deduplication; internal hosts skip domain lookup

### Behavior 5: File Change HMR

- **Given**: HMR is enabled in development mode with file watchers active
- **When**: A file changes in watched directories
- **Then**: Changes are batched via `OptimizedFileWatcher` (configurable debounce), content hashes filter unchanged files, AI directory changes trigger re-discovery, `ReloadNotifier` fires invalidation (immediate) then reload (debounced 300ms), connected HMR clients receive update broadcast
- **Edge cases**: `.cache/`, `node_modules/`, `.git/`, `.veryfront/` paths are ignored; files saved without content changes are skipped

### Behavior 6: Per-Project Environment Variable Isolation

- **Given**: A request in proxy mode with an environment ID and token
- **When**: The handler fetches env vars from the API and executes with `runWithProjectEnv()`
- **Then**: `AsyncLocalStorage` provides per-request env var overlay; `getProjectEnv()` returns project-scoped values; host process env is blocked when overlay is active
- **Edge cases**: Env var cache has 60s TTL with stale-on-error fallback; concurrent fetches are deduplicated; local projects skip env isolation

### Behavior 7: Project Isolation (Circuit Breaker)

- **Given**: A multi-tenant proxy serving multiple projects
- **When**: A project accumulates timeouts within the failure window (60s)
- **Then**: After 5 failures (configurable), the circuit opens and rejects requests for 30s with 503 + Retry-After header; concurrent requests per project are capped at 20 (configurable)
- **Edge cases**: Lightweight paths (modules, static assets) skip isolation checks; circuit resets after cooldown period

### Behavior 8: Cache Invalidation

- **Given**: A file change or deployment triggers cache invalidation
- **When**: `invalidateProjectCaches()` is called
- **Then**: Module path cache, SSR module cache, router detection cache, renderer cache, snippet cache, and API route handler cache are cleared for the specific project; environment-scoped and content-source-scoped registry caches are also cleared if project ID is available
- **Edge cases**: Without a real project slug (only "preview" and no project ID), cache invalidation is skipped entirely to prevent multi-tenant blast radius

### Behavior 9: `createHandler()` for Framework Integration

- **Given**: An external HTTP server (Hono, Express, Fastify, etc.)
- **When**: `createHandler()` is called with optional options
- **Then**: Returns a `VeryfrontHandler` with `upgrade()` for Node.js WebSocket handling and `connectHMR()` for native WebSocket runtimes (Bun/Deno); responses are normalized to native Response class to avoid DNT polyfill issues
- **Edge cases**: Production mode returns a handler without HMR capabilities; WebSocket messages are rate-limited and size-checked

### Behavior 10: Domain Parsing

- **Given**: A request host header
- **When**: `parseProjectDomain()` is called
- **Then**: Extracts slug, branch (via `--` separator), environment, and iframe embed permission from the domain; supports local dev domains (veryfront.me, lvh.me, veryfront.dev, localhost), production domains (veryfront.com, veryfront.org), and custom domains
- **Edge cases**: `{slug}.production.lvh.me` is explicit production (not dev host); `{slug}.lvh.me` mirrors production behavior; `*.localhost` is W3C secure context

## Constraints

- WebSocket upgrade requests must NOT be intercepted (breaks `Deno.upgradeWebSocket()`)
- In proxy mode, `x-project-slug` and `x-token` headers are mandatory for non-lightweight, non-monitoring paths
- `NODE_ENV` must be `production` when `PROXY_MODE=1`
- Request timeout is configurable via env var (default from middleware/timeout)
- Memory pressure at critical threshold (default 80% heap) rejects requests with 503
- Service worker generation is deterministic based on build manifest

## Error Handling

- Global error handler (`onGlobalError`) catches unhandled exceptions; fatal errors (stack overflow, OOM) allow process exit for orchestrator restart; non-fatal errors keep the process alive
- Request handler errors produce RFC 9457 problem detail responses
- Timeout produces a 504 Gateway Timeout with JSON body
- Isolation rejection produces a 503 with Retry-After header
- Bootstrap failures in production throw (non-recoverable); in development, they log and continue with defaults
- Domain lookup failures return null (request proceeds without project context)

## Side Effects

- `ReloadNotifier` is a module-level singleton managing global reload pub/sub
- `projectIsolation` is a module-level singleton managing circuit breaker state
- `requestTracker` is a module-level singleton tracking in-flight requests with periodic status logging
- `projectEnvStorage` registers global getters on `globalThis` for cross-module access
- `domainCache` and `localProjectCache` are module-level LRU caches registered for monitoring
- Production server main block registers signal handlers and starts OTLP/cache initialization
- `setSSRServerPort()` and `enableSSRFetchInterception()` modify global SSR state

## Performance Constraints

- Domain lookup cache: 1000 entries, 60s TTL, in-flight request deduplication
- Local project cache: 100 entries (LRU)
- Local adapter cache: 50 entries (LRU)
- Env var cache: 100 entries, 60s TTL, stale-on-error
- File watcher debounce: configurable (default 100ms dev, 300ms reload notifier)
- Content hashing (FNV-1a) for file change deduplication
- Request timeout: configurable via env var

## Invariants

- Every request gets a unique request ID (generated or forwarded from `x-request-id`)
- Monitoring endpoints always bypass domain resolution and project isolation
- In proxy mode, env vars from the host process are never leaked to remote project code
- Cache invalidation never wipes caches for all projects (prevented since multi-tenant blast radius fix)
- The handler ready promise resolves only after both listen and handler initialization complete
- `contentSourceId` is always computed and non-empty when enriched context is built
