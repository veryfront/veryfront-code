# NLSpec: src/errors/

## Purpose

Structured error system for the Veryfront platform providing slug-based error identity, RFC 9457 (Problem Details for HTTP APIs) compliant HTTP error responses, error boundaries for HTTP and CLI contexts, OpenTelemetry tracing integration, user-friendly CLI error formatting, and a catalog of error solutions with troubleshooting steps. The module defines two complementary error representations: `VeryfrontError` (a throwable Error subclass with slug, category, status, and metadata) and `VeryfrontErrorData` (a discriminated-union plain object for serializable error data). All errors are registered in a centralized registry keyed by slug strings, organized into 11 categories (CONFIG, BUILD, RUNTIME, ROUTE, MODULE, SERVER, BOUNDARY, DEV, DEPLOY, AGENT, GENERAL).

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `VeryfrontError` | class | Error subclass with slug, category, status, title, suggestion, detail, cause, instance, context fields; has `toRFC9457()` and `getDocsUrl()` methods |
| `defineError` | function | Creates a `RegisteredError` from an `ErrorDefinition`, adding a `.create()` factory method |
| `ErrorCategory` | type | Union of 11 category strings |
| `ErrorDefinition` | type | Shape for defining errors (slug, category, status, title, suggestion?) |
| `ErrorCreateOptions` | type | Options for `.create()` (detail, cause, instance, context, status override) |
| `RegisteredError` | type | ErrorDefinition extended with `.create()` factory |
| `RFC9457Response` | type | Shape of RFC 9457 JSON response body |
| `VeryfrontErrorOptions` | type | Full constructor options for VeryfrontError |
| `ERROR_REGISTRY` | const object | Map of all slug strings to their RegisteredError definitions |
| `ErrorSlug` | type | Union of all valid slug strings (keyof ERROR_REGISTRY) |
| `getErrorBySlug` | function | Look up a RegisteredError by slug |
| `getErrorsByCategory` | function | Filter all errors by category |
| `getAllSlugs` | function | Return all registered slug strings |
| 70+ error constants | RegisteredError | Individual error definitions (CONFIG_NOT_FOUND, BUILD_FAILED, etc.) |
| `createErrorResponse` | function | VeryfrontError -> RFC 9457 Response |
| `createErrorResponseFromDefinition` | function | RegisteredError + options -> RFC 9457 Response |
| `createProblemResponse` | function | Raw params -> RFC 9457 Response |
| `isVeryfrontError` | function | Type guard for VeryfrontError |
| `errorToResponse` | function | Unknown error -> RFC 9457 Response (wraps non-VeryfrontError as unknown-error) |
| `createErrorHandler` | function | Factory for Express/Hono error handler middleware |
| `formatErrorLog` | function | VeryfrontError -> formatted log string |
| `PROBLEM_JSON_CONTENT_TYPE` | const | "application/problem+json" |
| `httpErrorBoundary` | function | Wraps async handler fn with error catch -> RFC 9457 response + metrics + tracing |
| `wrapHandlerWithErrorBoundary` | function | Wraps a Handler object with httpErrorBoundary |
| `errorToRFC9457Response` | function | Error + HandlerContext + Request -> RFC 9457 Response (env-aware filtering) |
| `cliErrorBoundary` | function | Wraps async CLI handler with error catch -> formatted CLI output + exit(1) |
| `cliErrorBoundarySync` | function | Sync version of cliErrorBoundary |
| `formatCLIError` | function | Any error -> formatted CLI string with colors and docs link |
| `wrapUnknownError` | function | Any error -> VeryfrontError (passthrough if already VF, else wrap as unknown-error) |
| `wrapWithContext` | function | Any error + message + context -> VeryfrontError with merged context |
| `logError` | function | VeryfrontError + context -> structured console output (JSON in prod, human-readable in dev) |
| `logErrorWithMessage` | function | Prefix message + VeryfrontError -> logError with operation context |
| `ErrorLogEntry` | type | Shape of structured error log entry |
| `attachErrorToSpan` | function | Attach VeryfrontError metadata to an OpenTelemetry Span |
| `attachErrorToActiveSpan` | function | Attach VeryfrontError to the currently active OTel span (no-op if none) |
| `handleErrorWithFallback` | function | Async operation with fallback value on error |
| `handleErrorWithFallbackSync` | function | Sync operation with fallback value on error |
| `retryWithBackoff` | function | Retry async operation with exponential backoff |
| `withErrorContext` | function | Async operation with structured error logging and fallback |
| `withErrorContextSync` | function | Sync operation with structured error logging and fallback |
| `safeFileStat` | function | Safe file stat with logging fallback to null |
| `safeFileRead` | function | Safe file read with logging fallback to null |
| `safeReadDir` | function | Safe directory read with logging fallback to [] |
| `createErrorScope` | function | Create scoped error context helper for related operations |
| `ErrorContext` | type | Shape for error context (operation, path?, slug?, details?) |
| `ErrorHandlingOptions` | type | Options for withErrorContext (fallback, logLevel, includeStack) |
| `LogLevel` | type | "debug" \| "warn" \| "error" |
| `ERROR_CATALOG` | const | Merged catalog of all ErrorSolution entries |
| `getErrorSolution` | function | Look up ErrorSolution by slug |
| `searchErrors` | function | Search ErrorSolutions by text query |
| `createErrorSolution` | function | Factory for ErrorSolution with auto-generated docs URL |
| `createSimpleError` | function | Shorthand factory for ErrorSolution |
| Per-category catalogs | const | BUILD_ERROR_CATALOG, CONFIG_ERROR_CATALOG, etc. |
| `ErrorSolution` | type | Catalog solution shape (slug, title, message, steps?, example?, docs?, relatedErrors?, tips?) |
| `ErrorCatalog` | type | Record<ErrorSlug, ErrorSolution> |
| `PartialErrorCatalog` | type | Partial<ErrorCatalog> |
| `ERROR_SOLUTIONS` | const | User-friendly error solutions (message-pattern based, separate from slug-based catalog) |
| `formatUserError` | function | Error -> formatted user-friendly CLI string with solution |
| `identifyError` | function | Error -> error key string via message-pattern matching |
| `wrapErrorHandler` | function | Wraps async function with user-friendly error formatting + exit |
| `UserFriendlyErrorSolution` | type | Re-export of user-friendly ErrorSolution (Pick of catalog ErrorSolution) |
| `createError` | function | Identity function for VeryfrontErrorData (plain object) |
| `ensureError` | function | unknown -> Error (passthrough or wrap) |
| `getErrorMessage` | function | unknown -> string message |
| `toError` | function | VeryfrontErrorData -> Error with attached context |
| `VeryfrontErrorData` | type | Discriminated union of error data shapes (build, api, render, config, agent, file, network, permission, not_supported, no_ai_available) |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `serverLogger` | `#veryfront/utils/logger/logger.ts` | Structured logging in error-context.ts and error-handlers.ts |
| `cliLogger` | `#veryfront/utils/logger/logger.ts` | CLI logging in error-wrapper.ts |
| `isProduction` | `#veryfront/build/config/environment.ts` | Environment-aware log formatting in logging.ts and cli-error-boundary.ts |
| `DEFAULT_RETRY_*` | `#veryfront/utils/constants/retry.ts` | Default retry parameters in error-handlers.ts |
| `Handler, HandlerContext, HandlerResult` | `#veryfront/types` | HTTP handler types in http-error-boundary.ts |
| `recordErrorCount` | `#veryfront/observability/metrics/index.ts` | Error metrics in boundaries |
| `Span, SpanStatusCode` | `@opentelemetry/api` | Tracing integration |
| `trace` | `@opentelemetry/api` | Active span access in boundaries |
| `bold, cyan, dim, red, yellow` | `#veryfront/compat/console` | CLI color formatting |
| `box` | `#veryfront/utils/box.ts` | Error box formatting |
| `exit` | `#veryfront/platform/compat/process.ts` | Process exit in error-wrapper.ts |

## Behaviors

### Behavior 1: Error Definition and Registry
- **Given**: An error definition with slug, category, status, and title
- **When**: `defineError(definition)` is called
- **Then**: Returns a `RegisteredError` with a `.create(options?)` factory that produces `VeryfrontError` instances with the definition's fields merged with per-call options
- **Edge cases**: `options.status` overrides the definition's default status; missing `detail` falls back to `title` as the error message

### Behavior 2: RFC 9457 HTTP Error Responses
- **Given**: A VeryfrontError instance
- **When**: `createErrorResponse(error)` is called
- **Then**: Returns a `Response` with `application/problem+json` content type, the error's status code, and a JSON body containing type (docs URL), title, status, detail, instance, category, suggestion, cause
- **Edge cases**: `errorToResponse` wraps non-VeryfrontError values as unknown-error slug with 500 status

### Behavior 3: HTTP Error Boundary
- **Given**: An async handler function
- **When**: `httpErrorBoundary(handler)` wraps it and the handler throws
- **Then**: The error is wrapped as VeryfrontError, error metrics are recorded, error is attached to the active OTel span, and an RFC 9457 response is returned
- **Edge cases**: In production, stack traces and 5xx details are omitted from the response body; in dev mode, stack traces are included

### Behavior 4: CLI Error Boundary
- **Given**: An async or sync CLI handler function
- **When**: `cliErrorBoundary(handler)` wraps it and the handler throws
- **Then**: The error is formatted with colors (if TTY), slug, title, detail, suggestion, docs URL, and optional stack trace (dev only), then printed and `Deno.exit(1)` is called
- **Edge cases**: Non-TTY output strips ANSI color codes; non-VeryfrontError values are wrapped as unknown-error

### Behavior 5: Error Wrapping
- **Given**: An unknown error value
- **When**: `wrapUnknownError(error)` is called
- **Then**: If already a VeryfrontError, returns as-is; otherwise creates an unknown-error VeryfrontError preserving the original message and cause
- **Edge cases**: `wrapWithContext` merges additional context and prepends a message prefix

### Behavior 6: Structured Error Logging
- **Given**: A VeryfrontError and optional context
- **When**: `logError(error, context?)` is called
- **Then**: In production, outputs a single-line JSON `ErrorLogEntry` to stderr; in development, outputs human-readable multi-line format with colors and context
- **Edge cases**: Context from both the error and the call are merged

### Behavior 7: Error Tracing
- **Given**: A VeryfrontError and an OTel Span
- **When**: `attachErrorToSpan(error, span)` is called
- **Then**: Sets span status to ERROR, adds error.slug/category/status as span attributes, and adds an "error" event with slug/detail/suggestion

### Behavior 8: Error Handling with Fallback
- **Given**: An async/sync operation and a fallback value
- **When**: The operation throws
- **Then**: The error is logged via safeLog and the fallback value is returned
- **Edge cases**: `retryWithBackoff` retries up to maxRetries with exponential delay capped at maxDelay before throwing the last error

### Behavior 9: Safe File Operations
- **Given**: A filesystem adapter and a file path
- **When**: `safeFileStat`/`safeFileRead`/`safeReadDir` is called and the operation fails
- **Then**: The error is logged at debug level and null/[] is returned

### Behavior 10: Error Catalog Lookup
- **Given**: An error slug
- **When**: `getErrorSolution(slug)` is called
- **Then**: Returns the `ErrorSolution` with title, message, steps, example, docs, relatedErrors, tips -- or null if not found
- **Edge cases**: `searchErrors(query)` does case-insensitive substring matching against title, message, and steps

### Behavior 11: User-Friendly Error Identification
- **Given**: A plain Error
- **When**: `identifyError(error)` is called
- **Then**: Returns a key string based on message-pattern matching (e.g., "missing-config", "invalid-route", "port-in-use", etc.)
- **Edge cases**: Falls back to "unknown" if no pattern matches

### Behavior 12: VeryfrontErrorData (Plain Object Errors)
- **Given**: A plain error data object with type discriminator
- **When**: `toError(data)` is called
- **Then**: Returns an Error instance with `VeryfrontError[type]` name, the data attached as a non-enumerable `context` property, and stack trace pointing to the call site
- **Edge cases**: `fromError(error)` extracts the VeryfrontErrorData from an Error's context property, returning null if not present

## Constraints

- All error slugs must be unique across the registry
- RFC 9457 responses must always include `type`, `title`, `status`, and `category` fields
- The `type` field is always `https://veryfront.com/docs/errors/{slug}`

## Error Handling

- Error boundaries (HTTP and CLI) are the outermost catch-all; they never throw
- `safeLog` in error-handlers.ts wraps logging itself in try/catch to prevent logging failures from propagating
- `retryWithBackoff` throws the last error after exhausting all retries

## Side Effects

- `logError` (logging.ts): writes to stderr via `console.error`
- `cliErrorBoundary`/`cliErrorBoundarySync`: call `Deno.exit(1)` on error
- `httpErrorBoundary`: calls `recordErrorCount` (metrics) and `attachErrorToActiveSpan` (tracing)
- `wrapErrorHandler` (user-friendly): calls `exit(1)` if `import.meta.main`

## Performance Constraints

- Error registry is a static const object; lookups are O(1) by slug
- `searchErrors` does linear scan of all catalog entries
- `retryWithBackoff` uses `setTimeout` for delays (not blocking)

## Invariants

- Every VeryfrontError instance has a non-empty `slug`, valid `category`, and numeric `status`
- `wrapUnknownError` always returns a VeryfrontError (never throws)
- `getErrorMessage` always returns a string (never throws)
- `ensureError` always returns an Error instance (never throws)
