# NLSpec: src/security/

## Purpose

The security module provides a defense-in-depth layer for the Veryfront renderer and server. It handles input validation with size limits, CORS configuration, CSP and security header generation, CSRF token management, path traversal prevention, secure filesystem access, rate limiting, sandboxed code execution, authentication (Basic/Bearer), and Deno permission profiling. All sub-modules are designed for Deno runtime with zero `any` usage in production code.

## Public API

### Exports (from `src/security/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `BaseHandler` | class | Abstract HTTP handler with pattern matching, response building, and proxy context |
| `HandlerHelpers` | type | Helper interface for handler subclasses |
| `CommonSchemas` | object | Re-exported Zod schemas for common input patterns |
| `createValidatedHandler` | function | Wraps a handler with automatic Zod body/query validation |
| `createValidationError` | function | Factory for `VeryfrontError` with slug `input-validation-failed` |
| `DEFAULT_LIMITS` | const | Default request size limits (body, URL, header, file) |
| `INPUT_VALIDATION_FAILED` | const | Error registry entry for validation failures |
| `parseFormData` | function | Parse and validate multipart/urlencoded form data |
| `parseJsonBody` | function | Parse, validate, and optionally sanitize JSON request body |
| `parseQueryParams` | function | Parse and validate URL query parameters via Zod schema |
| `readBodyWithLimit` | function | Stream-read request body with byte-size limit |
| `sanitizeData` | function | Recursive XSS and prototype-pollution sanitizer |
| `validateRequestLimits` | function | Validate URL length, Content-Length, and header size |
| `AuthHandler` | class | Basic and Bearer auth handler (extends BaseHandler) |
| `loadSecurityConfig` | function | Load and validate SecurityConfig from project config |
| `SecurityConfigLoader` | class | Lazy-loading security config with CSP building |
| `setCors` | function | Simple synchronous CORS header setter |
| `CsrfHandler` | class | CSRF token validation handler (extends BaseHandler) |
| `applyCsrfCookie` | function | Set CSRF cookie on HTML GET/HEAD responses |
| `generateCsrfToken` | function | Generate CSRF token + Set-Cookie string |
| `validateCsrf` | function | Validate CSRF via double-submit cookie pattern |
| `isValidSecurityConfig` | function | Type guard for SecurityConfig shape |
| `applyCORSHeaders` | function | Async CORS header application with tracing |
| `applyCORSHeadersSync` | function | Synchronous CORS header application |
| `cors` | function | CORS middleware factory (validates config, handles preflight) |
| `corsSimple` | function | Simplified CORS middleware with defaults |
| `DEFAULT_CORS_HEADERS` | const | Default allowed headers (`Content-Type`, `Authorization`) |
| `CORS_MAX_AGE` | const | Default preflight max-age (86400s) |
| `DEFAULT_CORS_METHODS` | const | Default allowed methods (GET, POST, PUT, PATCH, DELETE, OPTIONS) |
| `handleCORSPreflight` | function | Handle CORS preflight requests with tracing |
| `isPreflightRequest` | function | Detect OPTIONS + CORS request headers |
| `shouldApplyCORS` | function | Check if CORS should be applied based on config and request |
| `validateCORSConfig` | function | Validate CORS config for security issues |
| `validateOrigin` | function | Async origin validation (supports function validators) |
| `validateOriginSync` | function | Sync origin validation |
| `applySecurityHeaders` | function | Apply CSP, HSTS, COOP, CORP, COEP, X-Frame-Options, etc. |
| `buildCacheControl` | function | Build Cache-Control header from strategy preset or object |
| `CACHE_DURATIONS` | const | Cache duration presets (SHORT=0, MEDIUM=3600, LONG=31536000) |
| `createResponseBuilder` | function | Factory for ResponseBuilder instances |
| `generateNonce` | function | Generate 16-byte random base64 nonce for CSP |
| `getSecurityHeader` | function | Resolve security header from config > env > default |
| `ResponseBuilder` | class | Fluent response builder with security, CORS, cache, and content-type methods |
| `createValidator` | function | Create a reusable path validator with default options |
| `PathValidationError` | const | Error code constants for path validation failures |
| `sanitizePathForDisplay` | function | Strip base directory from path for safe display |
| `validatePath` | function | Async path validation with symlink and existence checks |
| `validatePathSync` | function | Sync path validation (no filesystem access) |
| `ValidationPresets` | object | Preset validation configs (userInput, internal, build, static) |
| `createSecureFs` | function | Factory for SecureFs instances |
| `SecureFs` | class | Security-wrapped filesystem with path validation per operation |
| `SECURITY_VIOLATION` | const | Error registry entry for security violations |
| `wrapAdapterWithSecurity` | function | Wrap RuntimeAdapter with SecureFs overlay |
| `BUILD_HELPER_PERMISSIONS` | const | Deno permission flags for build helpers |
| `SERVER_PERMISSIONS` | const | Deno permission flags for server processes |
| `WORKFLOW_JOB_PERMISSIONS` | const | Restricted Deno permission flags for user code |

### Additional exports (from sub-module barrels, not top-level)

| Export | From | Description |
|--------|------|-------------|
| `validateContentType` | `input-validation/limits.ts` | Validate Content-Type against expected media types |
| `getColorSchemeFromRequest` | `http/client-hints.ts` | Extract color scheme from client hints or query param |
| `runInWorker` | `sandbox/deno-sandbox.ts` | Execute code in sandboxed Worker with timeout |
| `requestPermission` | `sandbox/permission-system.ts` | Request Deno permission with fallback for Node |
| `MemoryRateLimitStore` | `rate-limit/memory-store.ts` | In-memory rate limit store with auto-cleanup |
| `createRateLimiter` | `rate-limit/middleware.ts` | Rate limiting middleware factory |
| `RateLimitPresets` | `rate-limit/middleware.ts` | Pre-configured rate limiters (strict, moderate, lenient, auth) |
| `validateTrustedHtml` | `client/html-sanitizer.ts` | Defense-in-depth HTML validation for server-rendered content |
| `constantTimeEqual` | `utils/constant-time.ts` | Timing-safe string comparison |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `zod` | zod | Schema validation for input parsing |
| `#veryfront/types` | internal | HandlerContext, SecurityConfig, etc. |
| `#veryfront/platform/adapters/base.ts` | internal | RuntimeAdapter for filesystem operations |
| `#veryfront/errors` | internal | VeryfrontError, error registry |
| `#veryfront/observability` | internal | Tracing spans, metrics recording |
| `#veryfront/config` | internal | Project configuration loading |
| `#veryfront/utils` | internal | Logger, constants, base64url |
| `#veryfront/cache` | internal | Request cache batching |
| `#veryfront/middleware/core` | internal | Middleware types for CORS middleware |
| `#veryfront/compat/path` | internal | Cross-platform path utilities |
| `#veryfront/html` | internal | HTML escaping |

## Behaviors

### Behavior 1: Path Traversal Prevention
- **Given**: A path string and validation options (baseDir, level, allowedDirs)
- **When**: `validatePath()` or `validatePathSync()` is called
- **Then**: The path is checked for null bytes, length limits, forbidden patterns, traversal depth; normalized and resolved against baseDir; checked against allowedDirs allowlist; optionally checked for symlinks and existence
- **Edge cases**: Empty path resolves to baseDir; Windows backslashes normalized; absolute paths denied in strict mode unless allowAbsolute=true; sibling directories with shared prefix correctly rejected

### Behavior 2: Secure Filesystem Access
- **Given**: A `SecureFs` instance configured with baseDir, adapter, and security context
- **When**: Any filesystem operation (readFile, writeFile, stat, mkdir, remove, exists, readDir, watch) is called
- **Then**: The path is validated before the operation proceeds; security events are emitted; invalid paths throw SECURITY_VIOLATION errors (when throwOnError=true)
- **Edge cases**: `exists()` returns false (no throw) for invalid paths; `watch()` filters to valid paths; `readFileBytes()` falls back to encoding text when adapter lacks byte reader

### Behavior 3: Input Validation & Sanitization
- **Given**: An HTTP request with body/query parameters
- **When**: `parseJsonBody()`, `parseFormData()`, or `parseQueryParams()` is called with a Zod schema
- **Then**: Request limits are checked (URL length, body size, header size); content type is validated; body is parsed and validated against the schema; validation errors produce VeryfrontError with `input-validation-failed` slug
- **Edge cases**: Repeated query params coalesced into arrays; file size limits enforced in form data; sanitizeData optionally applied to JSON results

### Behavior 4: XSS and Prototype Pollution Sanitization
- **Given**: Untrusted data (string, object, array, or primitive)
- **When**: `sanitizeData()` is called
- **Then**: Strings have HTML entities escaped (&, <, >, ", ', /); object keys are sanitized (non-word chars stripped after NFKC normalization); keys containing `__proto__`, `constructor`, or `prototype` (case-insensitive, Unicode-aware) are removed; objects use null prototype; primitives pass through unchanged
- **Edge cases**: Unicode homoglyphs (U+017F long s, U+FF50 fullwidth p) are caught via NFKC normalization

### Behavior 5: CORS Origin Validation
- **Given**: A request origin and CORS config (boolean, string, array, or function)
- **When**: `validateOrigin()` or `validateOriginSync()` is called
- **Then**: Origin is matched against config; wildcard with credentials is denied; function validators support sync and async; rejected origins are logged and recorded as metrics
- **Edge cases**: No origin header with wildcard config returns `*`; `config=true` reflects any origin; async validators in sync context log warning and deny

### Behavior 6: CORS Preflight Handling
- **Given**: An OPTIONS request with `Access-Control-Request-Method` or `Access-Control-Request-Headers`
- **When**: `handleCORSPreflight()` is called
- **Then**: Origin is validated; allowed methods/headers/max-age are set; credentials header set for non-wildcard origins; rejected origins return 403 with error details
- **Edge cases**: No config returns 204 with no CORS headers; requested headers are echoed back when no explicit config

### Behavior 7: Security Header Application
- **Given**: Response headers, dev mode flag, nonce, and optional SecurityConfig
- **When**: `applySecurityHeaders()` is called
- **Then**: X-Content-Type-Options, X-XSS-Protection, Referrer-Policy are always set; X-Frame-Options set in production (unless isVeryfrontDomain); HSTS set in production; CSP built from env > userHeader > config; COOP/CORP/COEP resolved from config > env > defaults; custom headers from config.headers applied last (can override defaults)
- **Edge cases**: Dev mode skips X-Frame-Options, HSTS, and COOP; isVeryfrontDomain skips X-Frame-Options for iframe embedding

### Behavior 8: CSRF Double-Submit Cookie Pattern
- **Given**: CSRF enabled in security config
- **When**: GET/HEAD HTML requests arrive, `applyCsrfCookie()` sets a non-HttpOnly cookie; on POST/PUT/PATCH/DELETE, `CsrfHandler` validates cookie matches header
- **Then**: Cookie is set on first HTML page load; subsequent state-changing requests must include matching `x-csrf-token` header; mismatches return 403
- **Edge cases**: Asset paths, internal /_veryfront/ paths (except action endpoints), and /_ws are exempt; malformed cookies treated as missing (no throw); custom cookie/header names supported; excludePaths config for webhook endpoints

### Behavior 9: Authentication (Basic/Bearer)
- **Given**: Auth config from security config or environment variables
- **When**: A non-OPTIONS request arrives
- **Then**: Basic auth compares base64-encoded credentials using constant-time comparison; Bearer auth compares token after `Bearer ` prefix; failed auth returns 401
- **Edge cases**: Auth state reset per-request to prevent config leaking; realm value sanitized against CRLF/control chars; test environment flag skips env-based auth

### Behavior 10: Rate Limiting
- **Given**: Rate limit config with maxRequests, windowMs, and strategy
- **When**: Requests arrive through the rate limiter middleware
- **Then**: Key is derived from X-Forwarded-For or X-Real-IP; chosen strategy (fixed-window, sliding-window, or token-bucket) checks limits; rate limit headers (X-RateLimit-Limit/Remaining/Reset) added to all responses; exceeded limits return 429
- **Edge cases**: Skip function can bypass rate limiting; custom key generator and custom exceeded handler supported; sliding-window and token-bucket fall back to fixed-window for non-memory stores

### Behavior 11: Sandboxed Code Execution
- **Given**: A code string and optional timeout/memory limits
- **When**: `runInWorker()` is called
- **Then**: Code runs in a Web Worker with Deno permissions set to "none"; worker terminates on timeout; results communicated via postMessage
- **Edge cases**: Memory limits only supported in Node.js; compiled binaries use data: URLs instead of blob: URLs; worker errors and timeouts produce rejected promises

### Behavior 12: Response Building
- **Given**: A ResponseBuilder instance with security config
- **When**: Fluent methods are chained (withCORS, withSecurity, withCache, withETag, withHeaders, withStatus, withClientHints, withAllow)
- **Then**: Headers are accumulated and a Response is built with the configured status and content type
- **Edge cases**: Static helper methods (error, json, html, preflight, stream) require ResponseBuilder class to be initialized first; nonce is auto-generated if not provided

## Constraints

- No `any` in production code (only in test files for mock contexts)
- All path operations must normalize Windows backslashes
- Constant-time comparison required for all credential checks
- CSRF cookie must be non-HttpOnly for double-submit pattern
- CSP nonce must be cryptographically random (16 bytes from `crypto.getRandomValues`)
- Security headers must respect config overrides > environment variables > defaults
- Sanitized objects must use null prototype (`Object.create(null)`)

## Error Handling

- Path validation errors use `PathValidationError` code constants (NULL_BYTE, PATH_TOO_LONG, etc.)
- Input validation errors produce `VeryfrontError` with slug `input-validation-failed`
- Security violations produce errors via `SECURITY_VIOLATION.create()` from error registry
- CORS errors are logged and recorded as metrics via `recordCorsRejection()`
- Config loading failures are caught and logged at debug level (config is optional)
- Rate limiter errors fall through to next handler (fail-open)

## Side Effects

- `MemoryRateLimitStore` starts a `setInterval` for cleanup (must call `destroy()` to clear)
- `SecurityConfigLoader.ensureLoaded()` reads project config from filesystem
- `applySecurityHeaders()` calls `recordSecurityHeaders()` metrics
- `validateOrigin()` calls `recordCorsRejection()` on rejection
- `runInWorker()` creates and terminates Web Workers
- `applyCsrfCookie()` appends Set-Cookie to response headers
- CORS validators and security header application are wrapped in OpenTelemetry spans

## Performance Constraints

- Path validation must complete in under 0.1ms average (tested with 10K iterations)
- Constant-time comparison iterates over `Math.max(a.length, b.length)` to prevent timing attacks
- Rate limit memory store caps timestamps at 1000 per key
- Body reading streams chunks to avoid buffering entire request in memory

## Invariants

- Paths that resolve outside baseDir are always rejected regardless of security level
- Null bytes in paths are always rejected at all security levels
- `credentials: true` with `origin: "*"` is always denied (CORS spec requirement)
- Sanitized objects never contain keys with `__proto__`, `constructor`, or `prototype` substrings
- CSRF tokens are always 32 bytes of cryptographic randomness, base64url-encoded
- Response nonces are always 16 bytes of cryptographic randomness, base64-encoded
