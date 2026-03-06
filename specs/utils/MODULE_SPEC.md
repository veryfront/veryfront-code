# NLSpec: src/utils/

## Purpose

Shared utility module providing runtime detection, structured logging, application-wide constants (HTTP codes, cache TTLs, breakpoints, buffer sizes, security limits, CDN URLs, retry policies, handler priorities), hashing algorithms (SHA-256, FNV-1a, DJB2), memoization with in-flight deduplication, feature flags, LRU caching with tag-based invalidation and memory-pressure eviction, concurrency primitives (semaphore, singleflight, circuit breaker, parallel execution), file discovery, bundle manifest storage (in-memory, Redis, KV), environment variable loading from `.env` files, path normalization, route parameter extraction, cookie parsing, base64url encoding, HTML escaping, performance timing, memory profiling, request ID generation, terminal box drawing, and platform detection. Runs on Deno with cross-runtime compatibility (Node.js, Bun) via platform compat shims.

## Public API

### Exports (via `index.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `hasDenoRuntime`, `hasNodeProcess`, `hasBunRuntime` | function | Runtime detection type guards |
| `GlobalWithDeno`, `GlobalWithProcess`, `GlobalWithBun` | type | Runtime global type interfaces |
| `logger`, `serverLogger`, `rendererLogger`, `bundlerLogger`, `agentLogger` | Logger | Context-aware structured loggers (auto-inject request context via AsyncLocalStorage) |
| `refreshLoggerConfig` | function | Re-read LOG_LEVEL/LOG_FORMAT from env |
| `BREAKPOINT_SM/MD/LG/XL` | const | Responsive breakpoint pixel values |
| `HTTP_OK`, `HTTP_NOT_FOUND`, `HTTP_SERVER_ERROR`, etc. | const | HTTP status codes |
| `HTTP_CONTENT_TYPES` | const | Content-Type header values |
| `HASH_SEED_DJB2`, `HASH_SEED_FNV1A` | const | Hash algorithm seeds |
| `DEFAULT_LRU_MAX_ENTRIES` | const | Default LRU cache size (env-overridable) |
| `VERSION` | const | Framework version from deno.json |
| `computeHash`, `computeCodeHash`, `shortHash`, `fnv1aHash`, `simpleHash` | function | Hashing utilities |
| `MemoCache`, `memoize`, `memoizeAsync`, `memoizeHash` | class/function | Memoization with cache and in-flight dedup |
| `normalizePath` | function | Normalize file paths (backslashes, dot segments, trailing slashes) |
| `BundleCode`, `BundleMetadata`, `getBundleManifestStore` | type/function | Bundle manifest storage abstraction |
| `isRSCEnabled` | function | React Server Components feature flag |
| `isCompiledBinary` | function | Detect compiled Deno binary |
| `computeIntegrity`, `createLockfileManager`, `LockfileManager` | function/type | Import lockfile management with integrity verification |
| `startRequest`, `endRequest`, `startTimer`, `timeAsync`, `isEnabled` | function | Performance timing (opt-in via VERYFRONT_PERF=1) |
| `parallelMap` | function | Concurrent array mapping with semaphore |
| ~80 constants | const | Cache TTLs, buffer sizes, CDN URLs, retry policies, priorities, etc. |

### Non-barrel exports (imported directly by path)

| Export | Module | Description |
|--------|--------|-------------|
| `Singleflight` | singleflight.ts | Deduplicates concurrent async operations by key |
| `CircuitBreaker`, `getCircuitBreaker` | circuit-breaker.ts | Circuit breaker pattern with registry and eviction |
| `Semaphore`, `getSemaphore` | semaphore.ts | Concurrency limiter with timeout support |
| `LRUCache` | lru-wrapper.ts | High-level LRU cache with periodic cleanup |
| `LRUCacheAdapter`, `EntryManager`, `LRUListManager`, `LRUNode` | cache/stores/memory/ | Low-level LRU cache internals |
| `EvictionManager` | cache/eviction/ | Memory/entry-count eviction strategies |
| `getCacheNamespace`, `setCacheNamespace` | cache/keys/ | Cache key namespacing |
| `loadEnv`, `markEnvLoaded`, `hasEnvLoaded` | env-loader.ts | `.env` file loading with variable expansion |
| `discoverFiles`, `collectFiles`, `hasMatchingFiles`, `countFiles` | file-discovery.ts | Recursive file walking with filtering |
| `parseCookies`, `parseCookiesFromHeaders` | cookie-utils.ts | Cookie header parsing |
| `escapeHtml` | html-escape.ts | HTML entity escaping |
| `generateId`, `createIdGenerator` | id.ts | Random alphanumeric ID generation |
| `base64urlEncode`, `base64urlEncodeBytes` | base64url.ts | Base64url encoding |
| `box`, `joinHorizontal`, `joinVertical`, `divider` | box.ts | Terminal box drawing |
| `generateRequestId` | request-id.ts | Request ID generation (UUID) |
| `writeCacheFile`, `verifyCacheFileExists`, `isCacheWriteRaceError` | cache-file-ops.ts | Safe cache file write with race condition handling |
| `checkMemoryPressure`, `getHeapStats`, `getMemorySnapshot`, etc. | memory/profiler.ts | Memory monitoring and profiling |
| `capitalizeSeparatedWords` | case-utils.ts | String case conversion |
| `isDynamicSegment`, `extractRouteParams`, `extractParamsFromPattern`, etc. | route-path-utils.ts | Route path matching and parameter extraction |
| `joinPath`, `getExtension`, `getEsbuildLoader`, `isFrameworkSourcePath`, etc. | path-utils.ts | Path manipulation utilities |
| `getRedisClient`, `isRedisAvailable`, `disconnectRedis` | redis-client.ts | Redis client singleton management |
| `initializeBundleManifest`, `getBundleManifestTTL`, `warmupBundleManifest` | bundle-manifest-init.ts | Bundle manifest store initialization |
| `PATHS`, `FILE_EXTENSIONS` | paths.ts | Project directory/extension constants |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `#veryfront/platform/compat/process.ts` | Platform compat | Cross-runtime env/cwd/process access |
| `#veryfront/platform/compat/runtime.ts` | Platform compat | `isDeno`, `isBun`, `isNode` flags |
| `#veryfront/platform/compat/fs.ts` | Platform compat | Cross-runtime filesystem |
| `#veryfront/compat/path/index.ts` | Platform compat | Cross-runtime path.join/isAbsolute |
| `#veryfront/platform/adapters/base.ts` | Platform adapters | RuntimeAdapter type |
| `#veryfront/observability/tracing/otlp-setup.ts` | Observability | OpenTelemetry span instrumentation |
| `#veryfront/transforms/esm/package-registry.ts` | Transforms | React CDN URL generation (single source of truth) |
| `#veryfront/errors/veryfront-error.ts` | Errors | Error creation helpers |
| `#veryfront/config/defaults.ts` | Config | DEFAULT_PORT |
| `#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts` | Modules | Semaphore (used by parallel.ts) |
| `node:async_hooks` | Node.js stdlib | AsyncLocalStorage for request/cache context |
| `#deno-config` | deno.json | Version number |

## Behaviors

### Behavior 1: Runtime Detection
- **Given**: An unknown global object
- **When**: `hasDenoRuntime()`, `hasNodeProcess()`, or `hasBunRuntime()` is called
- **Then**: Returns true only if the global has the expected shape (Deno.env.get is a function, process.env is an object, Bun is defined)
- **Edge cases**: Null, undefined, non-object values all return false

### Behavior 2: Structured Logging
- **Given**: A logger instance (e.g., `serverLogger`)
- **When**: `.info("message", { key: "value" })` or `.error("msg", error)` is called
- **Then**: Outputs JSON (production) or colorized text (development) with timestamp, service tag, component, and context. Automatically injects request context from AsyncLocalStorage and OTel trace context.
- **Edge cases**: Logger config is eagerly resolved at module load to avoid env overlay interference during SSR

### Behavior 3: Memoization with In-Flight Dedup
- **Given**: A function wrapped with `memoize()` or `memoizeAsync()`
- **When**: Called with the same key multiple times
- **Then**: First call executes, subsequent calls return cached result. For async: concurrent calls with same key share a single in-flight promise. Failed promises are not cached.

### Behavior 4: LRU Cache with Eviction
- **Given**: An LRUCacheAdapter with maxEntries and maxSizeBytes limits
- **When**: Entries are added beyond limits
- **Then**: Least recently used entries are evicted. Expired entries (by TTL) are lazily evicted on access and periodically cleaned up. Tag-based invalidation removes all entries with a given tag.
- **Edge cases**: Size estimation recursively walks object properties with depth limit (10), handles circular references via WeakSet

### Behavior 5: Circuit Breaker
- **Given**: A CircuitBreaker with failure/success thresholds
- **When**: Operations fail repeatedly past the threshold
- **Then**: CLOSED -> OPEN (fails fast for resetTimeoutMs) -> HALF_OPEN (allows test calls) -> CLOSED (after successThreshold successes). Registry evicts stale CLOSED breakers when exceeding 1000 entries.

### Behavior 6: Singleflight Dedup
- **Given**: A Singleflight instance
- **When**: Multiple callers invoke `.do(key, operation)` concurrently with the same key
- **Then**: Only one operation executes; all callers receive the same result. On error, all callers receive the error. Key is cleaned up after completion.

### Behavior 7: Semaphore Concurrency Control
- **Given**: A Semaphore with N permits
- **When**: More than N operations attempt to acquire
- **Then**: Excess operations wait until permits are released. Optional timeout throws SemaphoreTimeoutError if acquisition takes too long.

### Behavior 8: Env File Loading
- **Given**: A project directory with `.env`, `.env.{NODE_ENV}`, `.env.local` files
- **When**: `loadEnv()` is called
- **Then**: Variables are parsed (supporting quotes, multiline, comments, variable expansion) and set in the environment. Existing env vars are not overridden unless `override: true`. Loading is idempotent (skipped if already loaded).

### Behavior 9: Bundle Manifest Storage
- **Given**: A BundleManifestStore (InMemory, Redis, or KV)
- **When**: Bundle metadata/code is stored and retrieved
- **Then**: Entries support TTL-based expiration, source-based invalidation (removes all bundles from a source file), and statistics. Redis/KV stores are stub implementations that reject with "not implemented".

### Behavior 10: Import Lockfile
- **Given**: A lockfile manager for a project directory
- **When**: `fetchWithLock()` is called for a URL
- **Then**: Checks lockfile for cached entry, verifies integrity (SHA-256), fetches fresh if missing/stale. Strict mode throws on integrity mismatch. Dirty entries are flushed to disk as sorted JSON.

### Behavior 11: File Discovery
- **Given**: A base directory and filter options (extensions, patterns, ignore patterns)
- **When**: `discoverFiles()` or `collectFiles()` is called
- **Then**: Recursively walks directories yielding matching files. Respects maxDepth, followSymlinks, and includeDirs options. Silently skips inaccessible directories and broken symlinks.

### Behavior 12: Route Parameter Extraction
- **Given**: A route pattern like `[id]/posts/[...slug]` and a URL slug
- **When**: `extractParamsFromPattern()` is called
- **Then**: Returns extracted params (`{ id: "123", slug: ["a", "b"] }`) or null if no match. Supports standard `[param]`, catch-all `[...param]`, and optional catch-all `[[...param]]` segments.

### Behavior 13: Performance Timing
- **Given**: VERYFRONT_PERF=1 environment variable
- **When**: `startRequest()`, `startTimer()`, `endRequest()` are called
- **Then**: Tracks timing entries per request with parent-child relationships, logs breakdown with percentages on request end. No-ops when disabled.

### Behavior 14: Memory Profiling
- **Given**: Registered caches and heap monitoring
- **When**: `getMemorySnapshot()` or `checkMemoryPressure()` is called
- **Then**: Returns heap stats (used/total/limit MB, usage percent), registered cache stats, and pressure assessment against configurable thresholds (default: warning at 75%, critical at 80%).

### Behavior 15: Parallel Execution
- **Given**: An array of items and an async function
- **When**: `parallelMap()` is called with optional concurrency options
- **Then**: Executes function for all items with semaphore-controlled concurrency (default: 20). Times out individual acquisitions after 30s. Results preserve input order.

### Behavior 16: Cache File Operations
- **Given**: A cache file path and content to write
- **When**: `writeCacheFile()` is called
- **Then**: Creates parent directory, writes file, verifies file exists after write. Returns false (instead of throwing) if directory is removed during write (race with cache cleanup). Throws for other write failures.

## Constraints

- All modules must work under Deno runtime with cross-runtime compatibility
- Constants are evaluated at module load time; some read env vars eagerly
- Logger config is eagerly resolved before per-request env overlays
- `LRUCache` cleanup intervals are automatically unref'd to avoid blocking process exit
- Redis client module is dynamically imported (`npm:@redis/client`) to avoid hard dependency
- Cache size estimation has a depth limit of 10 to prevent stack overflow on deep/circular structures

## Error Handling

- Hash functions: Propagate crypto.subtle errors
- Lockfile: Returns null on read failure; throws on fetch failure
- Cache file ops: Returns false for race conditions (ENOENT during write); throws for other errors
- Circuit breaker: Throws `CircuitBreakerOpen` when open; propagates operation errors
- Semaphore: Throws `SemaphoreTimeoutError` on acquisition timeout
- Env loader: Silently skips missing .env files; warns on parse errors
- Redis client: Singleton with reconnect delay; throws on failed connection with backoff
- File discovery: Silently skips inaccessible directories and broken symlinks
- Memory profiler: Returns -1 entries for caches that fail to report stats

## Side Effects

- `loadEnv()`: Sets process/Deno environment variables
- `setCacheNamespace()`: Mutates globalThis.__VF_CACHE_NAMESPACE__
- `startMemoryMonitoring()`: Creates a recurring interval timer
- `LRUCache` constructor: Creates interval timer for periodic cleanup (unref'd)
- Logger module: Eagerly resolves config from env at import time
- `trace-bridge.ts`: Registers OTel getter as side effect import
- `request-context.ts`: Registers request context getter at import time
- `getRedisClient()`: Establishes persistent Redis connection
- `ensureCacheNodeModules()`: Creates symlink in filesystem

## Performance Constraints

- `simpleHash` (hash-utils.ts) uses DJB2 for O(n) string hashing
- `fnv1aHash` uses FNV-1a with Math.imul for fast 32-bit hashing
- `memoize` simpleHash is FNV-1a with base-36 output (10-15x faster than JSON.stringify)
- LRU cache size estimation is recursive but depth-limited to 10
- Parallel execution defaults to 20 concurrent operations with 30s acquisition timeout
- Cache cleanup intervals default to 60s
- Circuit breaker registry caps at 1000 entries with LRU eviction of stale (1hr+) CLOSED breakers

## Invariants

- `memoize`/`memoizeAsync` never cache rejected promises
- `Singleflight` always cleans up the key after operation completes (success or failure)
- `Semaphore` permit count never goes below 0 or above maxPermits
- `CircuitBreaker` state transitions are logged
- `LRUCacheAdapter` currentSize tracks actual estimated bytes (updated on every set/delete/eviction)
- `EvictionManager` evicts from tail (least recently used) first
- Logger format (JSON vs text) is determined once at module load and only changes via `refreshLoggerConfig()`
- `loadEnv()` is idempotent after first successful call
- Bundle manifest store is a singleton; `setBundleManifestStore()` replaces the global instance
