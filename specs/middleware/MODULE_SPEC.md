# NLSpec: src/middleware/

## Purpose
Framework-agnostic HTTP middleware system providing a composable pipeline, request context, and a library of built-in middleware (CORS, rate limiting, logging, timeout, auth, CSRF, CSP, security headers). The core pipeline implements Koa-style onion execution where each middleware can run logic before and after downstream handlers. Built-in middleware uses a lightweight `Middleware` type compatible with both the core `Context` and simpler `{ request: Request }` objects via a `getRequest` adapter.

## Public API

### Exports (from `src/middleware/index.ts` via `#veryfront/middleware`)
| Export | Type | Description |
|--------|------|-------------|
| `MiddlewareContext` | class | Concrete `Context` implementation with key-value store, response helpers |
| `MiddlewarePipeline` | class | Fluent builder: `use()`, `useFor()`, `compose()`, `execute()`, `handle()`, `teardown()` |
| `MiddlewarePipelineOptions` | type | Pipeline constructor options (currently empty placeholder) |
| `Context` | type | Request context interface (`req`, `request`, `env`, `var`, helpers) |
| `ExecutionContext` | type | Workers-style execution context (`waitUntil`, `passThroughOnException`) |
| `MiddlewareFactory` | type | `(options?) => MiddlewareHandler` |
| `MiddlewareHandler` | type | `(c: Context, next: Next) => Response \| undefined \| Promise<...>` |
| `Next` | type | `() => Promise<Response \| undefined> \| Response` |
| `CorsOptions` | type | Options for the full CORS middleware |
| `cors` | function | Full CORS middleware (re-exported from `#veryfront/security`) |
| `rateLimit` | function | In-memory rate limiter with pluggable store |
| `RateLimitOptions` | type | Options for `rateLimit` |
| `MemoryRateLimitStore` | class | Default in-memory rate limit store with TTL cleanup |
| `RedisRateLimitStore` | class | Redis-backed rate limit store (lazy-loads `@redis/client`) |
| `RedisRateLimitOptions` | type | Options for `RedisRateLimitStore` |
| `RateLimitStore` | type | Store interface: `increment(key, windowMs)`, `reset(key)` |
| `logger` | function | Configurable HTTP request logger (multiple formats) |
| `devLogger` | function | Shorthand for `logger({ format: "dev" })` |
| `prodLogger` | function | Shorthand for `logger({ format: "json" })` |
| `LoggerOptions` | type | Logger configuration |
| `LogFormat` | type | `"combined" \| "common" \| "dev" \| "short" \| "tiny" \| "json"` |
| `timeout` | function | Request timeout middleware (returns 504) |
| `timeoutFromEnv` | function | Timeout middleware configured from `REQUEST_TIMEOUT_MS` env var |
| `getTimeoutFromEnv` | function | Reads timeout value from environment config |
| `TimeoutOptions` | type | Timeout configuration |

### Internal exports (from `src/middleware/builtin/security/index.ts`)
| Export | Type | Description |
|--------|------|-------------|
| `corsSimple` | function | Lightweight single-origin CORS middleware |
| `csrfProtection` | function | CSRF token validation for state-changing methods |
| `contentSecurityPolicy` | function | CSP header middleware with nonce support |
| `securityHeaders` | function | Adds X-Frame-Options, HSTS, Referrer-Policy, etc. |

### Not yet exported via barrel
| Export | Type | Description |
|--------|------|-------------|
| `basicAuth` | function | HTTP Basic authentication middleware |
| `bearerAuth` | function | Bearer token authentication middleware |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `HTTP_*` constants | `#veryfront/utils` | HTTP status codes |
| `MS_PER_SECOND`, `MS_PER_MINUTE` | `#veryfront/utils` | Time unit constants |
| `CLEANUP_INTERVAL_MULTIPLIER` | `#veryfront/utils/constants/cache.ts` | Rate limit store cleanup interval |
| `serverLogger` | `#veryfront/utils` | Structured server logging |
| `HTTP_REDIRECT_FOUND` | `#veryfront/utils` | 302 redirect status |
| `createError`, `toError`, `ensureError`, `getErrorMessage` | `#veryfront/errors/veryfront-error.ts` | Error normalization |
| `withSpan` | `#veryfront/observability/tracing/otlp-setup.ts` | Pipeline execution tracing |
| `RuntimeAdapter` | `#veryfront/platform/adapters/base.ts` | Environment access for error detail control |
| `unrefTimer` | `#veryfront/platform/compat/process.ts` | Prevent cleanup interval from keeping process alive |
| `validateOriginSync` | `#veryfront/security/http/cors/validators.ts` | CORS origin validation |
| `constantTimeEqual` | `#veryfront/security/utils/constant-time.ts` | Timing-safe credential comparison |
| `getEnvironmentConfig` | `#veryfront/config/environment-config.ts` | Env-based timeout config |
| `cors` | `#veryfront/security` | Full CORS implementation (re-exported) |

## Behaviors

### Behavior 1: Pipeline composition (onion model)
- **Given**: A `MiddlewarePipeline` with N middleware added via `use()`
- **When**: `execute(req)` or `handle(req, handler)` is called
- **Then**: Middleware runs in registration order; each receives `(context, next)` and can run code before/after calling `next()`; the response propagates back up through the stack
- **Edge cases**: Calling `next()` twice throws `"next() called multiple times"`; empty pipeline returns 404

### Behavior 2: Scoped middleware routing
- **Given**: Middleware registered via `useFor(pattern, ...handlers)`
- **When**: A request is processed
- **Then**: Scoped handlers are appended to the chain only when `pattern.test(pathname)` matches; global middleware always runs first
- **Edge cases**: Multiple patterns can match the same path; all matching handlers are appended in registration order

### Behavior 3: Pipeline error handling
- **Given**: A middleware throws during execution
- **When**: The error propagates to the executor
- **Then**: A 500 JSON response is returned with `{ error, method, url }`; in development mode (`NODE_ENV=development` via adapter), `message` and `stack` are included
- **Edge cases**: Non-Error thrown values are normalized via `ensureError`

### Behavior 4: Pipeline handle() with final handler
- **Given**: A pipeline with `handle(req, handler)`
- **When**: Middleware calls `next()`
- **Then**: The final handler is invoked instead of the default 404 response
- **Edge cases**: If middleware short-circuits (does not call next), the handler is never invoked

### Behavior 5: Request timeout enforcement
- **Given**: `timeout({ timeoutMs })` middleware is active
- **When**: Downstream processing exceeds `timeoutMs`
- **Then**: Returns 504 with JSON body `{ error, timeoutMs, path }`; the timer is always cleaned up in `finally`
- **Edge cases**: Health check paths (`/healthz`, `/readyz`, `/_health`) are excluded by default; non-timeout errors are re-thrown

### Behavior 6: Rate limiting
- **Given**: `rateLimit({ maxRequests, windowMs })` middleware is active
- **When**: A client key exceeds `maxRequests` within the time window
- **Then**: Returns 429 with `Retry-After` header (seconds until window reset)
- **Edge cases**: Default key is `x-forwarded-for` header or `"anonymous"`; supports legacy `rateLimit(maxRequests, windowMs)` call signature; `MemoryRateLimitStore` auto-cleans expired entries on a timer

### Behavior 7: Redis rate limit store
- **Given**: `RedisRateLimitStore` is used as the rate limit store
- **When**: `increment()` is called
- **Then**: Redis INCR + pEXPIRE atomically tracks counts; pTTL determines `resetAt`
- **Edge cases**: Lazy-connects to Redis on first use; re-sets expiry if pTTL returns -1 (key has no expiry); throws config error if `@redis/client` is not available

### Behavior 8: HTTP request logging
- **Given**: `logger({ format })` middleware is active
- **When**: A request completes (success or error)
- **Then**: Logs method, path, status, duration in the chosen format; JSON format includes structured fields (requestId, traceId, projectSlug, remoteAddr, userAgent)
- **Edge cases**: `skip` function can suppress logging for specific requests; if `next()` throws, logs 500 status and re-throws; if response is `undefined`, logs 500

### Behavior 9: Basic and Bearer authentication
- **Given**: `basicAuth()` or `bearerAuth()` middleware is active
- **When**: Request lacks valid credentials
- **Then**: Returns 401 Unauthorized; `basicAuth` includes `WWW-Authenticate` header with realm; `bearerAuth` sets `c.var.token` on success
- **Edge cases**: Credentials are compared using constant-time equality; `bearerAuth` supports async `verifyToken` callback

### Behavior 10: CSRF protection
- **Given**: `csrfProtection(validate)` middleware is active
- **When**: A state-changing request (POST/PUT/PATCH/DELETE) is received
- **Then**: Requires valid `X-CSRF-Token` header; returns 403 if missing or invalid; GET/HEAD/OPTIONS pass through
- **Edge cases**: None

### Behavior 11: Security headers
- **Given**: `securityHeaders(options)` middleware is active
- **When**: A response passes through
- **Then**: Adds X-Content-Type-Options (nosniff), X-Frame-Options, Referrer-Policy, Permissions-Policy; optionally adds CSP and HSTS headers
- **Edge cases**: `noSniff: false` disables X-Content-Type-Options; CSP accepts string or directive object; undefined response from next is passed through unchanged

### Behavior 12: Content Security Policy
- **Given**: `contentSecurityPolicy(directives, options)` middleware is active
- **When**: A response passes through
- **Then**: Builds and sets `Content-Security-Policy` header from directive key-value pairs
- **Edge cases**: Nonce is appended to `script-src`; `merge` option prepends additional directives; undefined response from next is passed through unchanged

### Behavior 13: Simple CORS
- **Given**: `corsSimple(origin)` middleware is active
- **When**: An OPTIONS preflight is received
- **Then**: Returns 204 with `Access-Control-Allow-Origin`, `Allow-Methods`, `Allow-Headers`
- **Edge cases**: For non-preflight requests, clones the response to add CORS header; undefined response from next is passed through unchanged

### Behavior 14: Pipeline teardown
- **Given**: Callbacks registered via `onTeardown(cb)`
- **When**: `teardown()` is called
- **Then**: All callbacks run sequentially; errors are logged but do not prevent remaining callbacks from running; callback list is cleared after execution
- **Edge cases**: Calling `teardown()` twice does not re-run callbacks; supports async callbacks

### Behavior 15: MiddlewareContext helpers
- **Given**: A `MiddlewareContext` instance
- **When**: `json()`, `text()`, `html()`, `redirect()` are called
- **Then**: Returns appropriate `Response` with correct content-type and status
- **Edge cases**: `set()`/`get()` use a private `Map` for key-value storage; `redirect` defaults to 302

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside `src/middleware/`
- `MiddlewarePipelineOptions` is an empty placeholder (`Record<string, never>`) for forward compatibility
- `xssProtection` is defined in `SecurityHeadersOptions` but not yet implemented in `securityHeaders()`

## Error Handling
- Pipeline executor catches all errors, normalizes via `ensureError`, returns structured 500 JSON
- Development mode (via `RuntimeAdapter`) includes error message and truncated stack trace (first 10 lines)
- Timeout middleware uses a sentinel `Symbol` to distinguish timeout from other errors
- Rate limit Redis store throws a config error if the Redis client module cannot be loaded
- Teardown errors are logged via `serverLogger.warn` but swallowed

## Side Effects
- `MemoryRateLimitStore` starts a `setInterval` for cleanup (unref'd to avoid keeping process alive); disabled when `globalThis.__vfDisableLruInterval` is true
- `RedisRateLimitStore` lazily opens a persistent Redis connection
- `logger` middleware writes to `serverLogger` or a custom `log` function
- Pipeline execution is wrapped in an OpenTelemetry span (`middleware.pipeline.execute`)

## Performance Constraints
- `composeMiddleware` allocates the middleware chain array once per request (copies global + matching scoped handlers)
- `MemoryRateLimitStore` cleanup runs at `windowMs * CLEANUP_INTERVAL_MULTIPLIER` interval
- Timeout uses `Promise.race` with `setTimeout`; timer is always cleared in `finally`
- Redis rate limit store reuses a single connection (lazy singleton pattern)

## Invariants
- `next()` can only be called once per middleware in the chain; double-call throws
- The pipeline always returns a `Response` (never undefined) — `execute()` and `handle()` both guarantee this via fallback 404 or the error handler
- Built-in middleware functions accept both `{ req: Request }` and `{ request: Request }` context shapes via `getRequest()`
- `basicAuth` and `bearerAuth` use constant-time comparison to prevent timing attacks
