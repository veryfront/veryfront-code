# NLSpec: src/repositories/

## Purpose

The repositories module provides a data-access abstraction layer for filesystem and cache operations, scoped to a project/environment/version context. It enforces project isolation through automatic key prefixing (scoped keys), wraps secure filesystem access via SecureFs, and supports multi-tier caching (L1 in-memory + L3 distributed backend). The module also provides a factory for constructing repositories from handler context, plus mock implementations for testing.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `CacheRepository<T>` | interface | Generic cache with get/set/delete, optional prefix-delete, has, clear, and stats |
| `CacheRepositoryOptions` | type (Zod-inferred) | Config: name, defaultTtlSeconds, maxEntries |
| `CacheStats` | type (Zod-inferred) | Stats object: gets, hits, misses, sets, deletes, hitRate |
| `FileSystemRepository` | interface | Async file ops: read, write, exists, stat, readDir, mkdir, remove |
| `RepositoryContext` | type (Zod-inferred) | Scoping triple: projectId, environment, versionId |
| `createFileSystemRepository` | function | Factory that returns a `SecureFsRepository` |
| `SecureFsRepository` | class | FileSystemRepository backed by SecureFs with path validation |
| `SecureFsRepositoryConfig` | interface | Config for SecureFsRepository: baseDir, adapter, context, securityContext, throwOnError |
| `buildScopedKey` | function | Builds `projectId:environment:versionId:key` string |
| `createMemoryCacheRepository<T>` | function | Factory for in-memory LRU cache repository |
| `MemoryCacheRepository<T>` | class | LRU-based in-memory cache with TTL and stats tracking |
| `createMultiTierCacheRepository` | function | Factory for L1+L3 multi-tier cache repository |
| `MultiTierCacheRepository` | class | L1 memory + L3 distributed backend cache with stats |
| `createRepositoryContext` | function | Constructs a RepositoryContext from explicit args |
| `createRepositoryFactory` | function | Extracts context from HandlerContext and returns a RepositoryFactory |
| `extractRepositoryContext` | function | Derives RepositoryContext from a HandlerContext |
| `RepositoryFactory` | class | Creates fs/cache repositories with shared config |
| `RepositoryFactoryConfig` | interface | Config for RepositoryFactory: adapter, baseDir, context |

### Testing Exports (from `./testing/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `MockFileSystemRepository` | class | In-memory mock with call tracking |
| `MockCacheRepository<T>` | class | In-memory mock cache with call tracking and stats |
| `createMockRepositoryContext` | function | Returns a default test RepositoryContext |
| `TrackedCall` | interface | Recorded method call: method, args, timestamp |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `DirEntry`, `FileInfo`, `RuntimeAdapter` | `#veryfront/platform/adapters/base.ts` | Filesystem type definitions |
| `createSecureFs`, `SecureFs`, `SecurityContext` | `#veryfront/security/secure-fs.ts` | Path-validated filesystem access |
| `HandlerContext` | `#veryfront/types` | Extract repository context from request handlers |
| `CacheBackend` | `#veryfront/cache/backend.ts` | Distributed cache backend (e.g., Redis) |
| `CacheTier`, `MultiTierCache` | `#veryfront/cache/multi-tier.ts` | Multi-tier cache orchestration |
| `rendererLogger` | `#veryfront/utils` | Debug logging in multi-tier cache |
| `z` (zod) | `zod` | Schema definitions for types |

## Behaviors

### Behavior 1: Scoped key generation
- **Given**: A RepositoryContext with projectId, environment, and versionId
- **When**: `buildScopedKey(context, "manifest.json")` is called
- **Then**: Returns `"projectId:environment:versionId:manifest.json"`
- **Edge cases**: All context fields may contain colons (no escaping is performed)

### Behavior 2: Memory cache get/set with TTL
- **Given**: A MemoryCacheRepository with defaultTtlSeconds=300
- **When**: A value is set and then retrieved before TTL expires
- **Then**: The value is returned
- **Edge cases**: Expired entries return null and are lazily deleted from the store

### Behavior 3: Memory cache LRU eviction
- **Given**: A MemoryCacheRepository at maxEntries capacity
- **When**: A new key (not already in the store) is set
- **Then**: The oldest entry (first Map key) is evicted before the new entry is added

### Behavior 4: Memory cache delete by prefix
- **Given**: A MemoryCacheRepository with multiple scoped keys
- **When**: `deleteByPrefix("pages/")` is called
- **Then**: All keys matching the scoped prefix are deleted; count is returned

### Behavior 5: Multi-tier cache read-through
- **Given**: A MultiTierCacheRepository with L1 (memory) and L3 (backend) tiers
- **When**: `get(key)` is called
- **Then**: MultiTierCache checks L1 first, then L3; on L3 hit, backfills L1 asynchronously
- **Edge cases**: If backend lacks `delByPattern`, `deleteByPrefix` returns 0 with a debug log

### Behavior 6: Filesystem operations via SecureFs
- **Given**: A SecureFsRepository with a configured baseDir and securityContext
- **When**: Any filesystem method (readFile, writeFile, exists, stat, readDir, mkdir, remove) is called
- **Then**: The call is delegated to SecureFs which validates paths against the baseDir
- **Edge cases**: `writeFile` with Uint8Array decodes to string before delegating (SecureFs only accepts strings)

### Behavior 7: Context extraction from HandlerContext
- **Given**: A HandlerContext from an HTTP request
- **When**: `extractRepositoryContext(ctx)` is called
- **Then**: projectId comes from projectSlug ?? projectId ?? "unknown"; environment from resolvedEnvironment or requestContext.mode; versionId from releaseId ?? enriched.contentSourceId ?? enriched.releaseId ?? "draft"

### Behavior 8: Repository factory creation
- **Given**: A HandlerContext with adapter, projectDir, and context fields
- **When**: `createRepositoryFactory(ctx)` is called
- **Then**: Returns a RepositoryFactory that can create fs and cache repositories with the extracted context

### Behavior 9: Stats tracking
- **Given**: Any cache repository (Memory or MultiTier)
- **When**: `getStats()` is called
- **Then**: Returns a CacheStats snapshot with gets, hits, misses, sets, deletes, and computed hitRate

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/repositories/
- Must pass: deno fmt --check, deno lint, deno test

## Error Handling
- FileSystemRepository throws via SecureFs on path traversal violations or missing files (ENOENT)
- MockFileSystemRepository throws `Error("ENOENT: no such file: ...")` for missing files
- MockFileSystemRepository throws `Error("ENOENT: no such file or directory: ...")` for stat on missing paths
- Cache repositories do not throw on misses; they return null

## Side Effects
- `rendererLogger.debug()` is called in MultiTierCacheRepository.deleteByPrefix when backend lacks delByPattern
- MultiTierCache performs async backfill from L3 to L1 on cache hits (fire-and-forget)
- MemoryTier and MemoryCacheRepository mutate internal Map stores on get (lazy TTL expiry)

## Performance Constraints
- MemoryCacheRepository defaults to 500 max entries with LRU eviction
- MultiTierCacheRepository L1 defaults to 500 max entries
- Default TTL is 300 seconds for both implementations
- Async backfill avoids blocking reads on L3 hits

## Invariants
- All cache keys are scoped: `projectId:environment:versionId:userKey`
- RepositoryContext.environment is always "production" or "preview"
- hitRate is always between 0 and 1 (or 0 when no gets have occurred)
- CacheStats counters are non-negative integers
- SecureFsRepository always delegates to SecureFs (never bypasses path validation)
