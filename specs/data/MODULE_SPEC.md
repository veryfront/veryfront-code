# NLSpec: src/data/

## Purpose

Server-side data fetching for pages in the Veryfront rendering pipeline. Provides a `DataFetcher` facade that dispatches to specialised fetchers (`ServerDataFetcher`, `StaticDataFetcher`, `StaticPathsFetcher`) depending on the page module's exports and the runtime mode (development vs production). Includes an LRU-backed cache with stale-while-revalidate semantics, per-project fairness via semaphore and slot limits, circuit breakers per project, and tracing spans for observability. Helper functions `notFound()` and `redirect()` offer ergonomic shortcuts for common data-function return values.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `DataFetcher` | class | Facade: `fetchData`, `getStaticPaths`, `clearCache` |
| `notFound` | function | Returns `{ notFound: true }` |
| `redirect` | function | Returns `{ redirect: { destination, permanent } }` |
| `CacheEntry` | type | Cache entry shape (data + timestamp + revalidate) |
| `DataContext` | type | Context passed to data functions (params, query, request, url) |
| `DataResult` | type | Union return: props, redirect, notFound, revalidate |
| `InferGetServerDataProps` | type | Utility to extract props type from a `PageWithData` |
| `PageWithData` | type | Page module shape with optional data functions |
| `StaticPathsResult` | type | Result of `getStaticPaths` (paths + fallback mode) |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `RuntimeAdapter` | `#veryfront/platform/adapters/base.ts` | Optional adapter passed through to sub-fetchers (currently unused) |
| `withSpan`, `SpanNames` | `#veryfront/observability/tracing/` | Wrap data fetches in OpenTelemetry spans |
| `serverLogger` | `#veryfront/utils` | Structured error/warn/debug logging |
| `DATA_FETCH_TIMEOUT_MS` | `#veryfront/config/defaults.ts` | Timeout for user data functions |
| `TimeoutError`, `withTimeoutThrow` | `#veryfront/rendering/utils/stream-utils.ts` | Abort long-running data fetches |
| `getSemaphore` | `#veryfront/utils/semaphore.ts` | Limit concurrent background revalidations |
| `MAX_CONCURRENT_REVALIDATIONS`, `REVALIDATION_PER_PROJECT_LIMIT`, `REVALIDATION_TIMEOUT_MS`, `DATA_FETCHING_MAX_ENTRIES`, `DATA_FETCHING_TTL_MS` | `#veryfront/utils/constants/cache.ts` | Tuning constants for cache and revalidation |
| `getCircuitBreaker`, `CircuitBreakerOpen` | `#veryfront/utils/circuit-breaker.ts` | Per-project circuit breaker for fetch failures |
| `LRUCache` | `#veryfront/utils/lru-wrapper.ts` | In-memory LRU cache backing `CacheManager` |
| `getProjectScopedKey` | `#veryfront/cache/cache-key-builder.ts` | Build cache keys scoped by project/version/mode |
| `getDisableLruIntervalEnv` | `#veryfront/config/env.ts` | Feature flag to disable LRU TTL sweep (tests) |
| `zod` | `zod` | Schema definitions in `schemas/data.schema.ts` |
| `@opentelemetry/api` | `@opentelemetry/api` | `Span` type for static-paths tracing |

## Behaviors

### Behavior 1: Mode-based dispatch (DataFetcher.fetchData)
- **Given**: A page module with both `getServerData` and `getStaticData`
- **When**: `fetchData` is called in development mode (default)
- **Then**: `getServerData` is preferred
- **Edge cases**: In production mode, `getStaticData` is preferred; if only one function exists, it is always used regardless of mode; if neither exists, returns `{ props: {} }`

### Behavior 2: Server data fetching (ServerDataFetcher)
- **Given**: A page module with `getServerData`
- **When**: The function is invoked
- **Then**: The full `DataContext` (params, query, request, url) is passed; the result is normalised (redirect/notFound short-circuit, props default to `{}`)
- **Edge cases**: Errors are logged and re-thrown; `TimeoutError` and `CircuitBreakerOpen` get distinct log messages

### Behavior 3: Static data fetching with caching (StaticDataFetcher)
- **Given**: A page module with `getStaticData` in production mode
- **When**: The function is invoked
- **Then**: Only `params` and `url` are passed (no `request`/`query`); result is cached by pathname + params; subsequent requests return cached data
- **Edge cases**: In preview mode (cache key is null), caching is disabled and every call fetches fresh; `CircuitBreakerOpen` fails fast

### Behavior 4: Stale-while-revalidate (StaticDataFetcher)
- **Given**: A cached entry whose age exceeds its `revalidate` seconds
- **When**: A request hits the stale entry
- **Then**: Stale data is returned immediately; a background revalidation is started (once per cache key)
- **Edge cases**: Per-project slot limit prevents one project from monopolising revalidations; global semaphore limits total concurrency; semaphore timeout skips revalidation gracefully

### Behavior 5: Static paths generation (StaticPathsFetcher)
- **Given**: A page module with `getStaticPaths`
- **When**: `getStaticPaths` is called
- **Then**: Returns `{ paths, fallback }` with span attributes for path count and fallback mode
- **Edge cases**: Returns `null` when `getStaticPaths` is not defined; null result from the function is normalised to `{ paths: [], fallback: false }`

### Behavior 6: Cache management (CacheManager)
- **Given**: An LRU cache instance
- **When**: `get`/`set`/`delete`/`clear`/`clearPattern` are called
- **Then**: Standard CRUD operations; `clearPattern` deletes all keys containing the pattern string; `shouldRevalidate` returns true when entry age exceeds `revalidate * 1000` ms
- **Edge cases**: `shouldRevalidate` returns false when `revalidate` is `false`, `undefined`, or non-numeric; `createCacheKey` returns `null` outside production context (preview mode / no context)

### Behavior 7: Helper functions
- **Given**: A user data function needs to signal redirect or 404
- **When**: `redirect(destination, permanent?)` or `notFound()` is called
- **Then**: Returns a well-formed `DataResult` with only the relevant field set

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/data/
- Must pass: `deno fmt --check src/data/` and `deno lint src/data/` and `deno test --no-check --allow-all src/data/`

## Error Handling
- User data functions (`getServerData`, `getStaticData`, `getStaticPaths`) are wrapped in `withTimeoutThrow`; `TimeoutError` is caught and logged with structured context before re-throwing.
- `CircuitBreakerOpen` is caught separately with a warn-level log including `retryAfterMs`.
- All other errors are logged via `logError` (calls `serverLogger.error`) with duration and pathname, then re-thrown.
- Background revalidation errors are caught and logged but do NOT propagate (stale data was already returned).
- Semaphore acquisition timeout during revalidation is silently skipped with a warn log.

## Side Effects
- **Logging**: `serverLogger.error` / `.warn` / `.debug` on failures, timeouts, circuit breaker opens, and skipped revalidations.
- **Tracing**: OpenTelemetry spans wrap every fetch and cache operation via `withSpan`.
- **State mutation**: LRU cache is mutated on set/delete/clear; `pendingRevalidations` map tracks in-flight background fetches; `projectRevalidationCounts` map tracks per-project concurrency.

## Performance Constraints
- LRU cache is bounded by `DATA_FETCHING_MAX_ENTRIES` with optional TTL sweep.
- Concurrent background revalidations are bounded by `MAX_CONCURRENT_REVALIDATIONS` (global semaphore) and `REVALIDATION_PER_PROJECT_LIMIT` (per-project fairness).
- Data fetch timeout is `DATA_FETCH_TIMEOUT_MS`; revalidation timeout is `REVALIDATION_TIMEOUT_MS`.
- Circuit breaker per project prevents cascading failures (5 failures open, 30s reset, 2 successes close).

## Invariants
- `fetchData` always returns a `DataResult` (never throws to the caller unless the underlying data function throws).
- `getStaticData` never receives `request` or `query` in its context.
- A cache key is `null` in preview mode, ensuring preview always fetches fresh data.
- At most one background revalidation runs per cache key at a time.
- Per-project revalidation slots are always released in `finally` blocks.
