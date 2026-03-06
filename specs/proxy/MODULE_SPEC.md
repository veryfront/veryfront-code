# NLSpec: src/proxy/

## Purpose

The proxy module is a standalone HTTP reverse proxy that sits in front of the Veryfront renderer/server. It resolves incoming requests to projects (via Veryfront subdomains or custom domains), authenticates using OAuth client credentials, enforces environment-level access protection, and forwards requests to the appropriate renderer instance. It supports WebSocket upgrades for HMR, sticky-session routing via DNS-based jump-consistent hashing, dedicated server resolution per environment, and tiered token caching (memory or Redis with circuit-breaker fallback). In production it runs as an isolated process ("split mode") for security isolation of OAuth credentials.

## Public API

### Exports

| Export | Type | Source File | Description |
|--------|------|-------------|-------------|
| `createProxyHandler` | function | handler.ts | Factory that creates the core proxy request-processing pipeline |
| `injectContextHeaders` | function | handler.ts | Injects resolved proxy context as internal headers onto a Request |
| `INTERNAL_PROXY_HEADERS` | const array | handler.ts | List of internal header names stripped from client requests and injected by the proxy |
| `ProxyConfig` | interface | handler.ts | Configuration for API base URL, OAuth credentials, local projects |
| `ProxyContext` | interface | handler.ts | Result of processing a request: token, project, environment, error info |
| `ProxyLogger` | interface | handler.ts | Logger interface accepted by the proxy handler |
| `ProxyHandlerOptions` | interface | handler.ts | Options for `createProxyHandler` |
| `ProxyHandler` | type | handler.ts | Return type of `createProxyHandler` |
| `TokenManager` | class | token-manager.ts | Manages OAuth token lifecycle with caching, deduplication, negative cache |
| `TokenScope` | type | token-manager.ts | `"preview" \| "production"` |
| `OAuthConfig` | interface | token-manager.ts | OAuth credential configuration |
| `TokenManagerOptions` | interface | token-manager.ts | Options for TokenManager constructor |
| `fetchOAuthToken` | function | oauth-client.ts | Low-level OAuth client_credentials token fetch |
| `TokenResponse` | interface | oauth-client.ts | Shape of an OAuth token response |
| `OAuthTokenConfig` | interface | oauth-client.ts | Config for `fetchOAuthToken` |
| `isRetryableConnectionError` | function | retry.ts | Checks if a fetch error is a transient connection error worth retrying |
| `RendererRouter` | class | renderer-router.ts | Sticky-session router using DNS discovery + jump-consistent hashing |
| `jumpHash` | function | renderer-router.ts | FNV-1a + jump-consistent hash for deterministic bucket assignment |
| `ServerResolver` | class | server-resolver.ts | Resolves environment IDs to dedicated server hostnames via internal API |
| `proxyLogger` | instance | logger.ts | Singleton structured logger (JSON in production, colored text in dev) |
| `runWithProxyRequestContext` | function | logger.ts | Runs a function with request context in AsyncLocalStorage |
| `getProxyRequestContext` | function | logger.ts | Retrieves current proxy request context |
| `ProxyRequestContext` | interface | logger.ts | Shape of per-request logging context |
| `LogLevel` | type | logger.ts | `"debug" \| "info" \| "warn" \| "error"` |
| Tracing exports | various | tracing.ts | `initializeOTLPWithApis`, `shutdownOTLP`, `extractContext`, `injectContext`, `startServerSpan`, `endSpan`, `withContext`, `withSpan`, `getTraceContext`, `ProxySpanNames` |
| `getEnv` | function | env.ts | Cross-runtime env var accessor (Deno / Node.js) |
| Cache exports | various | cache/index.ts | `createCache`, `createCacheFromEnv`, `MemoryCache`, `RedisCache`, `ResilientCache`, types |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `parseProjectDomain` | `#veryfront/server/utils/domain-parser.ts` | Parse host into slug, environment, branch |
| `computeContentSourceId` | `#veryfront/cache/keys.ts` | Compute cache key for content source |
| `createFileSystem` | `#veryfront/platform/compat/fs.ts` | Filesystem access for local project discovery |
| `exit, getEnv, onSignal, unrefTimer, cwd` | `#veryfront/platform/compat/process.ts` | Cross-runtime process utilities |
| `createHttpServer, upgradeWebSocket` | `#veryfront/platform/compat/http/index.ts` | HTTP server abstraction |
| `ErrorPages` | `../server/utils/error-html.ts` | HTML error page templates |
| `resolve4` | `node:dns/promises` | DNS resolution for renderer discovery |
| `AsyncLocalStorage` | `node:async_hooks` | Per-request logging context |
| `createClient` | `redis` | Redis client for distributed token cache |
| OpenTelemetry packages | `@opentelemetry/*` | Distributed tracing (dynamically imported) |
| `denoConfig` | `#deno-config` | Version string from deno.json |

## Behaviors

### Behavior 1: Request routing

- **Given**: An incoming HTTP request to the proxy
- **When**: The router receives the request
- **Then**: It dispatches to one of: WebSocket upgrade handler, stats endpoint, health endpoint, API proxy (`/_vf/api/*`), or forward-to-server (default)
- **Edge cases**: WebSocket detection is case-insensitive on the `upgrade` header

### Behavior 2: Domain resolution and project identification

- **Given**: A request with a `host` header
- **When**: `processRequest` is called
- **Then**:
  - Veryfront subdomains (`slug.preview.veryfront.com`) extract slug directly from the hostname
  - Custom domains trigger a domain lookup API call to resolve the slug, project ID, environment, and release ID
  - Local projects (mapped via `LOCAL_PROJECTS` env or filesystem discovery) skip token fetch entirely
  - Bare Veryfront domains without a slug return a no-project context
- **Edge cases**: Ports are stripped from the host before domain matching; custom domain matching is case-insensitive

### Behavior 3: Token priority cascade

- **Given**: A request requiring authentication
- **When**: Resolving the token
- **Then**: Tokens are resolved in priority order:
  1. User auth cookie (`authToken`) -- only for preview scope
  2. OAuth client_credentials token (via `TokenManager`)
  3. Static `apiToken` fallback
  4. No token (may cause 502 for custom domains)
- **Edge cases**: Local projects bypass token fetch entirely

### Behavior 4: Protected environment access control

- **Given**: A request targeting a protected environment
- **When**: The environment's `protected` flag is true
- **Then**:
  - No auth cookie: 302 redirect to `https://veryfront.com/sign-in?from=<path>`
  - Malformed JWT: 302 redirect (treat as unauthenticated)
  - Valid JWT but user not a project member: 403
  - Valid JWT and user is a project member: access granted
- **Edge cases**: Open redirect prevention collapses `//evil.com` paths to `/evil.com`; redirect URL includes only pathname + search (never origin)

### Behavior 5: Production release requirement

- **Given**: A production-scope request with a resolved project slug
- **When**: No active release ID is found and the project is not local
- **Then**: Returns 404 with slug `"release-not-found"` (rendered as HTML error page by main.ts)

### Behavior 6: Server forwarding with retry

- **Given**: A request to forward to the renderer server
- **When**: The fetch to the server fails with a retryable connection error
- **Then**: Idempotent methods (GET, HEAD, OPTIONS) are retried up to `VERYFRONT_SERVER_RETRY_COUNT` times with `VERYFRONT_SERVER_RETRY_DELAY_MS` delay; non-idempotent methods are not retried
- **Edge cases**: If the first attempt targets a dedicated server and fails, retries fall back to the shared pool; AbortError (timeout) returns 504 immediately without retry

### Behavior 7: Sticky-session renderer routing

- **Given**: Multiple renderer instances discovered via DNS or static targets
- **When**: Routing a request for a project slug
- **Then**: Uses jump-consistent hashing (FNV-1a) to deterministically map the slug to a renderer instance, ensuring session affinity
- **Edge cases**: Falls back to the default URL when no targets available, no slug provided, or the target list is stale (>5 minutes since last successful refresh)

### Behavior 8: Dedicated server resolution

- **Given**: An environment with a dedicated server assigned
- **When**: `ServerResolver.resolve(environmentId)` is called
- **Then**: Returns the dedicated server URL; caches the result with a 30s TTL; deduplicates concurrent requests for the same environment
- **Edge cases**: Transient API errors (network failures, non-2xx) are NOT cached, allowing immediate retry on the next request; returns null (shared pool fallback) on any error

### Behavior 9: Token caching with negative cache

- **Given**: An OAuth token request
- **When**: `TokenManager.getToken` is called
- **Then**: Checks cache first (with refresh buffer before expiry); deduplicates concurrent fetches for the same cache key; on 400/404 errors, stores a negative cache entry for 5 minutes
- **Edge cases**: Negative cache has a max size of 1000 entries (FIFO eviction)

### Behavior 10: Resilient cache (circuit breaker)

- **Given**: Redis is configured as the token cache
- **When**: Redis operations fail
- **Then**: After 3 consecutive failures, opens the circuit and switches to the memory fallback cache for 30 seconds; after the circuit half-opens, tries the primary again; on success, switches back
- **Edge cases**: `set` always writes to fallback first (even when primary is healthy)

### Behavior 11: WebSocket proxy bridge

- **Given**: A WebSocket upgrade request
- **When**: The client WebSocket opens
- **Then**: Creates a server-side WebSocket to the renderer, bidirectionally bridges messages between client and server
- **Edge cases**: 30-second connection timeout; server connection errors close the client socket; client disconnect closes the server socket

### Behavior 12: API proxy (BFF pattern)

- **Given**: A request to `/_vf/api/*`
- **When**: `handleApiProxy` processes it
- **Then**: Strips the `/_vf/api` prefix, proxies to the Veryfront API with the resolved Bearer token; returns 401 if no token available

### Behavior 13: Structured logging

- **Given**: A log call
- **When**: In production (`NODE_ENV=production`)
- **Then**: Emits JSON with timestamp, level, service, version, trace IDs, and request context (from AsyncLocalStorage)
- **When**: In development
- **Then**: Emits colored text with timestamp, tag, glyph, and formatted context
- **Edge cases**: Log level filtering via `LOG_LEVEL` env var (default: `info`)

### Behavior 14: OpenTelemetry tracing

- **Given**: `OTEL_TRACES_ENABLED=true` with endpoint configured
- **When**: The proxy processes requests
- **Then**: Creates spans for server requests, token fetches, domain lookups, HTTP client calls, and cache operations; propagates W3C trace context between proxy and renderer
- **Edge cases**: All tracing is no-op when disabled; OpenTelemetry modules are dynamically imported

### Behavior 15: Graceful shutdown

- **Given**: SIGINT or SIGTERM received
- **When**: The shutdown handler runs
- **Then**: Closes the HTTP server, renderer router, server resolver, proxy handler (token manager + cache), and OTLP provider in sequence; exits with code 0
- **Edge cases**: Duplicate signals are ignored (`shuttingDown` guard)

## Constraints

- Do NOT change public API signatures
- Do NOT modify files outside src/proxy/
- Must pass: `deno fmt --check src/proxy/`, `deno lint src/proxy/`, `deno test --no-check --allow-all src/proxy/`

## Error Handling

- OAuth token errors: caught and logged; 400/404 responses trigger negative caching
- Domain lookup errors: caught and logged; returns null (treated as "not found")
- Server fetch errors: retried for idempotent methods on connection errors; timeout produces 504; exhausted retries produce 502
- Redis errors: circuit breaker switches to memory fallback after 3 failures
- Unhandled errors in request processing: caught at top level, returns 500

## Side Effects

- Network I/O: OAuth token requests, domain lookup API calls, server forward fetches, DNS resolution, Redis connections
- Timers: periodic DNS refresh (RendererRouter), periodic cache cleanup (MemoryCache, ServerResolver), WebSocket connect timeout
- AsyncLocalStorage: per-request logging context
- Console output: structured logs to stdout

## Performance Constraints

- Token cache avoids redundant OAuth calls; pending request deduplication prevents thundering herd
- Server resolver deduplicates concurrent lookups and caches results (30s TTL)
- Jump-consistent hashing provides session affinity without coordination
- Renderer router DNS refresh is periodic (default 15s) with stale target fallback
- WebSocket connect timeout: 30s; server request timeout: configurable (default 90s)

## Invariants

- Internal proxy headers (`x-token`, `x-project-slug`, etc.) are always stripped from client requests before injection -- clients cannot spoof internal context
- Production requests without an active release always return 404 (not a blank page)
- Protected environment access always requires both a valid JWT and project membership
- Redirect URLs never include the request origin (only pathname + search)
- Protocol-relative paths (`//evil.com`) are collapsed to prevent open redirects
- Token priority is fixed: user cookie > OAuth > static token > none
- Local projects never trigger token fetches or API lookups
