# NLSpec: src/cache/

## Purpose

The cache module provides a unified caching layer for the Veryfront renderer. It manages cache key generation, multi-tier caching (memory/disk/Redis/API), path tokenization for portable distributed code caching, per-request batch deduplication, dependency-aware cache invalidation, module-level LRU singletons, and a centralized metrics/registry system. All cache key formats, backends, and invalidation logic are consolidated here to ensure consistent tenant isolation, version-based invalidation, and cross-pod cache sharing.

## Public API

### Exports (via `index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `detokenizeAllCachePaths` | function | Replace `__VF_CACHE_DIR__` tokens with local cache directory in code strings |
| `tokenizeAllVeryFrontPaths` | function | Replace all veryfront cache paths (from any environment) with portable `__VF_CACHE_DIR__` tokens |
| `buildComponentCacheKey` | function | Build cache key for rendered component: `component:{projectId}:{filePath}:{contentHash}` |
| `buildDirCacheKeyPrefix` | function | Build prefix for directory listing cache keys |
| `buildErrorPageCacheKey` | function | Build cache key for error pages: `error:{projectId}:{pageType}` |
| `buildFileCacheKeyPrefix` | function | Build prefix for file content cache keys |
| `buildFileListCacheKey` | function | Build prefix for file list cache keys |
| `buildGitHubBytesCacheKey` | function | Build cache key for GitHub raw bytes |
| `buildGitHubContentCacheKey` | function | Build cache key for GitHub file content |
| `buildGitHubDirCacheKey` | function | Build cache key for GitHub directory listings |
| `buildGitHubResolveCacheKey` | function | Build cache key for GitHub path resolution |
| `buildGitHubStatCacheKey` | function | Build cache key for GitHub file stats |
| `buildGitHubTreeCacheKey` | function | Build cache key for GitHub repository trees |
| `buildModuleResolveCacheKey` | function | Build cache key for module resolution: `resolve:{specifier}:{referrer}` |
| `buildModuleTransformCacheKey` | function | Build cache key for module transform results |
| `buildProxyManagerCacheKey` | function | Build cache key for proxy manager: `proxy:{slug}:{mode}:{qualifier}` |
| `buildRedisSSRModuleKey` | function | Prepend Redis SSR module prefix to key |
| `buildStatCacheKeyPrefix` | function | Build prefix for file stat cache keys |
| `cacheRegistry` | CacheRegistry | Singleton registry of all in-memory cache stores |
| `FileOperationContext` | type | Context for file operation cache key generation |
| `initializeDistributedCaches` | function | Initialize all distributed cache backends (transform, SSR, file, CSS) |
| `registerLRUCache` | function | Register an LRU cache instance in the global registry |

### Exports (via `backend.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `MemoryCacheBackend` | class | In-memory cache with LRU eviction and byte-size limits |
| `RedisCacheBackend` | class | Redis-backed cache backend |
| `ApiCacheBackend` | class | HTTP API-backed cache backend with circuit breaker |
| `DiskCacheBackend` | class | Filesystem-backed cache with JSON envelope format |
| `createCacheBackend` | function | Factory: auto-detect best available backend (API > Redis > disk > memory) |
| `CacheBackends` | object | Named factory functions for domain-specific backends |
| `createDistributedCacheAccessor` | function | Lazy-init accessor with retry logic for distributed backends |
| `createDistributedCodeCacheAccessor` | function | Like above but returns TokenizingCacheGateway |
| `createTokenizingGateway` | function | Wrap a CacheBackend with automatic code tokenization/detokenization |
| `isApiCacheAvailable` | function | Check if API cache backend is available |
| `isDiskCacheConfigured` | function | Check if disk cache is configured via env vars |
| `isDistributedBackend` | function | Check if a backend type is distributed (non-memory) |
| `CacheBackend` | interface | Core interface all backends implement |
| `CodeCacheGateway` | interface | Gateway interface for code storage with tokenization |
| `TokenizingCacheGateway` | class | Implementation of CodeCacheGateway |

### Exports (via `keys.ts` / `keys/index.ts` barrel)

| Export | Type | Description |
|--------|------|-------------|
| `CacheKeyPrefix` | const object | All cache key prefix constants |
| `DEFAULT_EXCLUDED_QUERY_PARAMS` | string[] | Marketing/tracking params excluded from cache keys by default |
| `buildConfigCacheKey` | function | Build config cache key with version suffix |
| `buildTransformCacheKey` | function | Build transform cache key with deps/config hash tracking |
| `buildRenderCachePrefix` | function | Build render cache prefix: `{projectId}:{env}:{release}:{version}` |
| `buildRenderCacheKey` | function | Append content key to render cache prefix |
| `buildQueryAwareCacheKey` | function | Build cache key with sanitized query params |
| `computeContentSourceId` | function | Compute content source identifier for cache isolation |
| `parseRenderCacheKey` | function | Parse a render cache key into its components |
| `sanitizeQueryParamsForCacheKey` | function | Sanitize URL query params for safe use in cache keys |
| `filterQueryParams` | function | Filter query params based on policy (ignore/include/exclude) |
| `createCacheKeyFilter` | function | Create a predicate function for filtering cache keys |
| `getCacheKeyVersion` | function | Return current VERSION for cache key versioning |
| `getAllKeysForProject` | function | Get all in-memory cache keys for a project |
| `getAllKeysForProjectAsync` | function | Get memory + Redis cache keys for a project |
| `deleteAllKeysForProject` | function | Delete all in-memory cache keys for a project |
| `deleteAllKeysForProjectAsync` | function | Delete memory + Redis cache keys for a project |
| `isKeyForProject` | function | Check if a cache key belongs to a project |
| `extractProjectIdFromKey` | function | Extract project ID from a cache key |

### Other public modules

| Module | Key Exports | Description |
|--------|-------------|-------------|
| `hash.ts` | `fastHash`, `getCacheKey`, `sha256Hash`, `parseCacheKey` | Standardized cache hashing utilities |
| `config-hash.ts` | `computeConfigHash`, `computeConfigHashSync` | Hash transform-affecting configuration |
| `dependency-graph.ts` | `DependencyGraph`, `computeDepsHash`, `extractImports` | Dependency tracking for cache invalidation |
| `module-cache.ts` | `getModuleCache`, `getEsmCache`, `createModuleCache` | Pod-level LRU module cache singletons |
| `multi-tier.ts` | `MultiTierCache`, `CacheTier` | L1/L2/L3 cache abstraction with auto-backfill |
| `metrics.ts` | `cacheMetrics`, `instrumentCache`, `exportPrometheusMetrics` | Unified cache metrics collection |
| `request-cache-batcher.ts` | `runWithCacheBatching`, `getCachedWithBatching` | Per-request cache batch deduplication |
| `cache-key-builder.ts` | `runWithCacheKeyContext`, `getProjectScopedKey` | AsyncLocalStorage-based cache key context |
| `schemas/` | `CacheKeyContextSchema`, `CacheBackendTypeSchema` | Zod schemas for validation |
| `testing/` | `MockCacheBackend`, `runCacheInvariantTests` | Test utilities and invariant test suites |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `computeHash`, `simpleHash` | `#veryfront/utils/hash-utils.ts` | SHA-256 and simple numeric hashing |
| `VERSION` | `#veryfront/utils/version.ts` | Version-based cache key invalidation on deployments |
| `getCacheBaseDir` | `#veryfront/utils/cache-dir.ts` | Locate local cache directory for path tokenization |
| `LRUCache` | `#veryfront/utils/lru-wrapper.ts` | LRU cache implementation for module caches |
| `getRedisClient`, `isRedisConfigured` | `#veryfront/utils/redis-client.ts` | Redis client access |
| `withSpan` | `#veryfront/observability/tracing/otlp-setup.ts` | OpenTelemetry span instrumentation |
| `SpanNames` | `#veryfront/observability/tracing/span-names.ts` | Standardized span name constants |
| `getCircuitBreaker` | `#veryfront/utils/circuit-breaker.ts` | Circuit breaker for API cache backend |
| `ensureError` | `#veryfront/errors/veryfront-error.ts` | Normalize unknown errors |
| `CACHE_INVARIANT_VIOLATION` | `#veryfront/errors/error-registry.ts` | Error definition for portability violations |
| `parseAllImports` | `#veryfront/transforms/import-rewriter/parse-cache.ts` | Parse imports for dependency graph |
| `AsyncLocalStorage` | `node:async_hooks` | Request-scoped context for batching and key building |
| `zod` | `zod` | Schema validation for CacheKeyContext and backend types |

## Behaviors

### Behavior 1: Multi-tier cache lookup with backfill
- **Given**: A MultiTierCache configured with L1 (memory), L2 (disk), and L3 (distributed) tiers
- **When**: `get(key)` is called
- **Then**: Tiers are checked in order L1 -> L2 -> L3; on a hit at a lower tier, the value is backfilled to all higher tiers asynchronously (by default)
- **Edge cases**: If a tier throws, the error is logged and the next tier is tried; if all tiers miss, returns null

### Behavior 2: Path tokenization for distributed code cache
- **Given**: Code containing absolute filesystem paths (e.g., `file:///Users/dev/.cache/veryfront-http-bundle/...`)
- **When**: Code is stored via `TokenizingCacheGateway.setCode()`
- **Then**: All veryfront cache paths are replaced with `__VF_CACHE_DIR__` token before storage; on `getCode()`, tokens are replaced with the local cache directory
- **Edge cases**: Memory backends skip tokenization entirely (optimization); code from foreign build servers is tokenized via regex fallback; `assertPortableCode()` throws if hardcoded paths remain after tokenization

### Behavior 3: Per-request cache batch deduplication
- **Given**: A request is wrapped in `runWithCacheBatching()`
- **When**: Multiple `getCachedWithBatching()` calls occur concurrently within the same request
- **Then**: Keys are collected into a batch queue; after a 1ms delay (or when batch size limit is reached), a single `getBatch()` call is made to the backend; results are cached in request-scoped storage for subsequent reads within the same request
- **Edge cases**: Outside of batching context, falls back to direct `backend.get()`; duplicate keys within a batch are deduplicated

### Behavior 4: Cache key generation with tenant isolation
- **Given**: A project with a specific slug, environment (production/preview), and version (releaseId or branch)
- **When**: Any `build*CacheKey()` function is called
- **Then**: A deterministic, colon-separated cache key is produced containing the project identifier, environment context, and version; keys for different projects/environments never collide
- **Edge cases**: `buildProxyManagerCacheKey` throws if production mode lacks a releaseId; `buildSourceQualifier` throws if release source type lacks releaseId

### Behavior 5: Content source ID computation
- **Given**: A project's deployment context (local/remote, preview/production, branch, releaseId)
- **When**: `computeContentSourceId()` is called
- **Then**: Returns a unique identifier: `local-{branch}` for local dev, `preview-{branch}` for remote preview, `release-{releaseId}` for production
- **Edge cases**: Throws if production environment has no releaseId; null branch defaults to "main"

### Behavior 6: Cache registry and project-scoped invalidation
- **Given**: Multiple in-memory cache stores registered in `cacheRegistry`
- **When**: `deleteKeysForProject(projectId)` is called
- **Then**: All cache keys matching the project are deleted across all registered stores; supports environment-specific and content-source-specific invalidation
- **Edge cases**: Stores without `deleteWhere` are skipped gracefully; Redis keys are scanned and deleted separately via `deleteRedisKeysForProject()`

### Behavior 7: Dependency-aware transform cache invalidation
- **Given**: A source file with import dependencies
- **When**: `computeDepsHash()` is called
- **Then**: A dependency graph is built by recursively parsing imports; the hash combines content hashes of the file and all transitive dependencies
- **Edge cases**: Circular dependencies are handled via visited-set tracking; files that fail to load are treated as leaf nodes with no dependencies

### Behavior 8: Memory cache backend with byte-size limits
- **Given**: A `MemoryCacheBackend` with `maxEntries` and `maxSizeBytes` limits
- **When**: `set()` is called and the new entry would exceed either limit
- **Then**: Oldest entries are evicted (FIFO order) until the entry fits; entries exceeding `maxSizeBytes` on their own are silently dropped
- **Edge cases**: Overwriting an existing key first removes the old entry's size contribution; TTL-expired entries are cleaned up on `get()`

### Behavior 9: Cache backend auto-detection
- **Given**: Environment variables indicating available backends
- **When**: `createCacheBackend()` is called without `preferredBackend`
- **Then**: Backends are tried in priority order: API (production with API URL) > Redis (configured) > Disk (env var set) > Memory (fallback)
- **Edge cases**: `createDistributedCacheAccessor` caches the result and retries after 30 seconds on failure; memory-only results are not retried

### Behavior 10: Query parameter filtering for render cache keys
- **Given**: A URL with query parameters and a `QueryParamCacheOptions` policy
- **When**: `buildQueryAwareCacheKey()` is called
- **Then**: Query params are filtered per policy (ignore-all, include-all, include-list, exclude-list), sorted alphabetically, and sanitized to cache-key-safe characters; default policy excludes common tracking params (UTM, gclid, fbclid, etc.)
- **Edge cases**: URLs with no query params or only tracking params produce the base slug without a query suffix

### Behavior 11: Pod-level module cache singletons
- **Given**: A renderer pod
- **When**: `getModuleCache()` or `getEsmCache()` is called
- **Then**: Returns a lazily-initialized LRU cache singleton with configurable max entries and TTL; the cache is registered in the global `cacheRegistry`; `createModuleCache()` provides a `Map`-compatible interface over the LRU
- **Edge cases**: `destroyModuleCaches()` fully tears down and nullifies singletons; `clearModuleCacheForProject()` selectively removes keys by project prefix

### Behavior 12: Distributed cache initialization
- **Given**: A renderer starting up
- **When**: `initializeDistributedCaches()` is called
- **Then**: The best available backend is detected; transform, SSR module, file, and project CSS caches are initialized in parallel via `Promise.allSettled`; returns a status object indicating which caches were successfully initialized
- **Edge cases**: If backend is memory-only, returns immediately with all caches disabled; individual cache init failures are logged but don't block others

## Constraints

- Cache keys must use only `a-z A-Z 0-9 _ : . * - /` characters (API cache validation constraint)
- All code stored in distributed cache (Redis/API) MUST go through `TokenizingCacheGateway` to ensure portability
- Version string from `VERSION` is embedded in cache keys to auto-invalidate on deployments
- `MemoryCacheBackend` enforces both entry count and byte size limits simultaneously

## Error Handling

- Backend errors (Redis connection failures, API timeouts, disk I/O errors) are logged and swallowed; callers receive `null` on get, no-op on set
- `ApiCacheBackend` uses a circuit breaker (10 failure threshold, 15s reset) to fail fast during outages
- `assertPortableCode()` throws `CACHE_INVARIANT_VIOLATION` if code contains hardcoded paths that weren't tokenized
- `CacheKeyContextSchema` (Zod) validates that `projectId` and `versionId` are non-empty strings
- `computeContentSourceId` throws if production mode is missing a `releaseId`
- `buildProxyManagerCacheKey` throws if production mode is missing a `releaseId`

## Side Effects

- `initializeDistributedCaches()` triggers network connections to Redis/API
- `registerLRUCache()` / `registerMapCache()` mutate the global `cacheRegistry` singleton
- `getModuleCache()` / `getEsmCache()` lazily create global LRU singleton instances
- `runWithCacheBatching()` creates per-request `AsyncLocalStorage` context with timers for batch flushing
- `DiskCacheBackend.set()` writes JSON files to the filesystem using atomic rename
- `CacheRegistry.scanRedisKeys()` performs Redis SCAN operations
- `cacheMetrics` singleton accumulates metrics state across the process lifetime

## Performance Constraints

- `MemoryCacheBackend` uses O(1) Map operations; eviction is FIFO (oldest-insertion-order)
- `fastHash` uses DJB2 XOR variant for sub-microsecond hashing (no crypto overhead)
- `DiskCacheBackend` uses 4-seed FNV hash for key-to-filename mapping to minimize collisions
- Batch deduplication in `request-cache-batcher` uses 1ms delay window to coalesce concurrent reads
- `MultiTierCache` backfill is fire-and-forget by default (`asyncBackfill: true`) to avoid blocking reads
- `TokenizingCacheGateway` skips tokenization for memory backends (no-op optimization)
- Regex cache in `MemoryCacheBackend.delByPattern` and `DiskCacheBackend.delByPattern` is bounded to 100 entries

## Invariants

- A cache key for project A must never match project B (tenant isolation)
- `tokenize(code) -> detokenize(result)` must produce the original code (round-trip fidelity)
- Code stored in distributed cache must never contain absolute filesystem paths (portability)
- `cacheRegistry` stores are uniquely named; duplicate registration logs a warning and replaces
- `computeContentSourceId` produces distinct IDs for: local-dev vs preview vs production, different branches, and different releases
- `MultiTierCache` stats accurately reflect tier hit counts, miss counts, and backfill operations
- `MemoryCacheBackend.sizeBytes` is always consistent with the sum of stored entry sizes
