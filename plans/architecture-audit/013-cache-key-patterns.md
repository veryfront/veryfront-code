# Cache Key Patterns and Storage

## Executive Summary

The veryfront-renderer uses a multi-tier caching architecture spanning memory, disk, Redis/API, and request-scoped caches. There are **18+ distinct cache systems** with varying key formats, TTLs, and storage backends. This document catalogs every cache system, identifies inconsistencies, and highlights potential issues.

## Master Cache Table

| Cache Name | Key Format | Storage | TTL | Project Scoped |
|------------|-----------|---------|-----|----------------|
| Transform Cache | `v{version}:{filePath}:{hash}:{ssr\|browser}[:studio]` | API/Redis + Memory | 5min (300s) | No (content-hash) |
| HTTP Module Cache | `{prefix}:{hash}` (url/code/hash variants) | API/Redis + Disk | 24h (86400s) | No (URL-hash) |
| File Cache | `file:{env}:{projectSlug}:{qualifier}:{path}` | API/Redis + Memory | 5min (300s) | Yes |
| SSR Module Cache (Memory) | `{projectDir}:{projectId}:{modulePath}:{isSSR}` | LRU Memory | 30min | Yes |
| SSR Module Cache (Distributed) | `veryfront:ssr-module:{key}` | API/Redis | 6h prod / 10min preview | Yes |
| Render Cache | `{projectId}:{env}:{releaseKey}:{version}:page:{slug}[:theme-{color}]` | Memory LRU | Configurable | Yes |
| Data Fetching Cache | `veryfront:data:{projectId}:{pathname}::{params}` | LRU Memory | 10min | Yes |
| MDX Bundle Cache | `mdx:{mode}:{contentHash}` | Bundle Manifest Store | 7d prod / 1h dev | No (content-hash) |
| Module Path Cache (ESM) | `v{version}:_vf_modules/{path}.js` | Disk + Memory Map | Indefinite | No |
| Token Cache (Proxy) | `{scope}:{projectSlug\|global}` | Memory/Redis | JWT expiry - 2min buffer | Yes |
| Agent Cache | `cache_{hash(input)}` | Memory | Configurable (5min default) | No |
| React Version Cache | `{projectDir}` | Memory Map | Indefinite | Yes |
| CSS Bundle Cache | `{filePath}` | Memory Map | Build lifetime | No |
| Request Cache Batcher | Request-scoped keys | AsyncLocalStorage | Request lifetime | N/A |
| Component Cache | `component:{projectId}:{filePath}:{contentHash}` | Memory | - | Yes |
| Layout Cache | `layout:{projectId}:{contentSourceId}:{componentPath}:{hash}` | Memory | - | Yes |
| GitHub Adapter Caches | `github:{type}:{ref}:{path}` | Memory | - | Yes (by ref) |
| Config Cache | `{vf:}{projectId}:{version}` or `{projectDir}:{version}` | Memory | - | Yes |

---

## Detailed Cache Documentation

### 1. Transform Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/transform-cache.ts`
- **Key Format**: `v{TRANSFORM_CACHE_VERSION}:{filePath}:{contentHash}:{ssr|browser}[:studio]`
- **Value Type**: `TransformCacheEntry { code: string, hash: string, timestamp: number }`
- **Storage Backend**: API/Redis (primary) + Memory Map (fallback, max 500 entries)
- **TTL**: 5 minutes (300 seconds) default
- **Invalidation**:
  - Content-hash change automatically invalidates
  - Version bump via `TRANSFORM_CACHE_VERSION` invalidates all
  - LRU eviction in memory fallback

**Key Builder**: `buildTransformCacheKey()` in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`

```typescript
export function buildTransformCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
): string {
  const ssrKey = ssr ? "ssr" : "browser";
  const studioKey = studioEmbed ? ":studio" : "";
  return `v${TRANSFORM_CACHE_VERSION}:${filePath}:${contentHash}:${ssrKey}${studioKey}`;
}
```

---

### 2. HTTP Module Cache (esm.sh bundles)

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/http-cache.ts`
- **Key Format**: `{prefix}:{hash}` where prefix is `url`, `code`, or `hash`
  - `url:{hash}` - primary lookup by URL hash
  - `code:{hash}` - direct code recovery
  - `hash:{hash}` - URL mapping for debugging
- **Value Type**: Raw JavaScript code string
- **Storage Backend**:
  - Distributed: API/Redis
  - Local: Disk (`{cacheDir}/http-{hash}.mjs`)
  - Memory: LRU (max 2000 entries) for path lookups
- **TTL**: 24 hours (86400 seconds) in distributed cache
- **Invalidation**:
  - Incompatible file paths from different environments trigger re-fetch
  - Gzip-encoded content detection triggers re-fetch
  - TTL refresh every 4 hours to keep bundles valid

**Notes**:
- Uses `simpleHash(normalizedUrl)` for hash generation
- Hash is numeric, stored as string
- Bundles contain `file://` paths that are environment-specific

---

### 3. File Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/cache/file-cache.ts`
- **Key Format**: `file:{sourceType}:{projectSlug}:{qualifier}:{path}`
  - `sourceType`: `env` (environment), `branch`, `release`
  - `qualifier`: branch name, release ID, or `{envName}:{releaseId}`
- **Value Type**: `CacheEntry<T> { value: T, timestamp: number, size: number }`
- **Storage Backend**: API/Redis (primary) + Memory Map (fallback, max 200 entries, 10MB)
- **TTL**:
  - Backend: 5 minutes (300 seconds)
  - Memory: 1 minute (60000ms)
- **Invalidation**:
  - `deleteByPrefix(prefix)` for project-scoped invalidation
  - `deleteByPrefixAndSuffix(prefix, suffix)` for targeted invalidation
  - Automatic TTL expiry

**Key Builders** in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`:
- `buildFileCacheKeyPrefix(ctx)`
- `buildStatCacheKeyPrefix(ctx)`
- `buildDirCacheKeyPrefix(ctx)`
- `buildFileListCacheKey(ctx)`

---

### 4. SSR Module Cache

- **Files**:
  - Memory: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/memory.ts`
  - Distributed: `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/cache/redis.ts`

**Memory Cache**:
- **Key Format**: `{projectDir}:{projectId}:{modulePath}:{isSSR}`
- **Value Type**: `ModuleCacheEntry { tempPath: string, contentHash: string }`
- **Storage Backend**: LRU Memory (max 500 entries)
- **TTL**: 30 minutes (1800000ms)

**Distributed Cache**:
- **Key Format**: `veryfront:ssr-module:{key}` (prefix added by backend)
- **Value Type**: Raw transformed JavaScript code
- **Storage Backend**: API/Redis
- **TTL**:
  - Production: 6 hours (21600 seconds)
  - Preview: 10 minutes (600 seconds)
- **Invalidation**:
  - `clearSSRModuleCacheForProject(projectId)` - clears all project-related entries
  - `clearSSRModuleCache()` - clears entire cache

**Related Caches**:
- `globalCrossProjectCache` - LRU (500 entries) for cross-project modules
- `globalInProgress` - Map tracking in-flight transforms
- `globalTmpDirs` - LRU (100 entries) for temp directory tracking
- `failedComponents` - Map tracking transform failures
- `transformSemaphore` - Concurrency control (50 max)

---

### 5. Render Cache (Context-Aware)

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/shared/context-aware-cache.ts`
- **Key Format**: `{projectId}:{environment}:{releaseKey}:{VERSION}:page:{slug}[:theme-{light|dark}]`
- **Value Type**: `CachePayload { result: RenderResult, storedAt: number, expiresAt?: number }`
- **Storage Backend**: Memory LRU (default 500 entries, max 100 for memory store)
- **TTL**: Configurable via options (default: no expiry until explicit eviction)
- **Invalidation**:
  - `clearForContext(ctx)` - by cache prefix
  - `clearForProject(projectId)` - by project prefix
  - `clearSlug(slug, ctx)` - specific page + theme variants

**Cache Prefix Builder** in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`:
```typescript
export function buildRenderCachePrefix(
  projectId: string,
  environment: "preview" | "production",
  releaseKey: string,
): string {
  return `${projectId}:${environment}:${releaseKey}:${VERSION}`;
}
```

---

### 6. Data Fetching Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/data/data-fetching-cache.ts`
- **Key Format**: `veryfront:data:{projectId}:{pathname}::{params_json}`
- **Value Type**: `CacheEntry { data, timestamp, revalidate }`
- **Storage Backend**: LRU Memory (max 500 entries)
- **TTL**: 10 minutes (600000ms)
- **Invalidation**:
  - `clearPattern(pattern)` - substring match on keys
  - `shouldRevalidate(entry)` - based on `revalidate` config

**Key Builder** in same file uses `getProjectScopedKey()`:
```typescript
createCacheKey(context: DataContext): string | null {
  const params = JSON.stringify(context.params);
  const resourceKey = `${context.url.pathname}::${params}`;
  return getProjectScopedKey("veryfront:data", resourceKey);
}
```

---

### 7. MDX Bundle Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/mdx-cache-adapter.ts`
- **Key Format**: `mdx:{mode}:{contentHash}`
- **Value Type**:
  - Metadata: `BundleMetadata { hash, codeHash, size, compiledAt, source, mode, meta }`
  - Code: `BundleCode { code, sourceMap?, css? }`
- **Storage Backend**: Bundle Manifest Store (Memory by default, pluggable)
- **TTL**:
  - Production: 7 days (604800000ms)
  - Development: 1 hour (3600000ms)
- **Invalidation**:
  - `invalidateBundle(content)` - by content hash
  - `invalidateSource(source)` - by source file
  - `clearAll()` - full cache clear

**Stored in**: `/Users/mattboon/Sites/veryfront-renderer/src/utils/bundle-manifest.ts`

---

### 8. Module Path Cache (ESM Loader)

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/esm-module-loader/cache/index.ts`
- **Key Format**: `v{TRANSFORM_CACHE_VERSION}:_vf_modules/{relativePath}.js`
- **Value Type**: Disk file path string
- **Storage Backend**:
  - Memory: `Map<cacheDir, Map<modulePath, diskPath>>`
  - Disk: `{cacheDir}/_index.json` for persistence
- **TTL**: Indefinite (survives server restarts via disk persistence)
- **Invalidation**:
  - `clearModulePathCache()` - clears all
  - `invalidateModulePaths(changedPaths)` - selective invalidation
  - `clearESMDiskCache()` - removes disk cache files

---

### 9. Token Cache (Proxy)

- **Files**:
  - Memory: `/Users/mattboon/Sites/veryfront-renderer/proxy/cache/memory-cache.ts`
  - Redis: `/Users/mattboon/Sites/veryfront-renderer/proxy/cache/redis-cache.ts`
  - Resilient: `/Users/mattboon/Sites/veryfront-renderer/proxy/cache/resilient-cache.ts`

- **Key Format**: `{scope}:{projectSlug|global}`
  - `scope`: `preview` or `production`
  - `projectSlug`: project identifier or `global`
- **Value Type**: `TokenCacheEntry { token, expiresAt, scope, projectSlug }`
- **Storage Backend**:
  - Primary: Redis (via ResilientCache)
  - Fallback: Memory LRU
- **TTL**: JWT `exp` claim - 2 minute buffer (default 1 hour if no exp)
- **Invalidation**:
  - `invalidateToken(scope, projectSlug)`
  - `clearCache()` - full clear
  - Circuit breaker: 3 failures triggers 30s fallback to memory

---

### 10. Pod-Level Module Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/cache/module-cache.ts`
- **Key Format**: Varies by cache type
- **Value Type**: Module paths and ESM mappings
- **Storage Backend**: LRU Memory
- **TTL**:
  - Module Cache: 5 minutes (300000ms), max 10000 entries
  - ESM Cache: 10 minutes (600000ms), max 5000 entries
- **Invalidation**:
  - `clearModuleCacheForProject(projectId)`
  - Automatic LRU eviction

---

### 11. Agent Response Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/agent/middleware/cache/cache.ts`
- **Key Format**: `cache_{hash(input)}`
- **Value Type**: `CacheEntry { response: AgentResponse, cachedAt, expiresAt?, accessCount, lastAccessedAt }`
- **Storage Backend**: Memory (3 strategies: simple Map, LRU, TTL)
- **TTL**:
  - TTL strategy: 5 minutes (300000ms) default
  - LRU strategy: max 100 entries, no TTL
- **Invalidation**:
  - Automatic TTL expiry (TTL strategy)
  - LRU eviction (LRU strategy)
  - `clear()` - full clear

---

### 12. Request Cache Batcher

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/cache/request-cache-batcher.ts`
- **Key Format**: Same as underlying cache keys
- **Value Type**: Raw cache values from backend
- **Storage Backend**: AsyncLocalStorage (request-scoped)
- **TTL**: Request lifetime only
- **Invalidation**: Automatic at request end

**Features**:
- Batches multiple cache reads into single backend call
- Max batch size: 100
- Batch delay: 1ms
- Deduplicates concurrent requests for same key

---

### 13. React Version Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/react/compat/version-detector/version-cache.ts`
- **Key Format**: `{projectDir}` (absolute path)
- **Value Type**: `ReactVersionInfo { version, features }`
- **Storage Backend**: Memory Map
- **TTL**: Indefinite
- **Invalidation**:
  - `clearProjectVersionCache(projectDir)`
  - `__resetReactVersionCacheForTests()`

---

### 14. GitHub Adapter Caches

- **File**: Referenced in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`
- **Key Formats**:
  - `github:content:{ref}:{path}`
  - `github:bytes:{ref}:{path}`
  - `github:dir:{ref}:{path}`
  - `github:stat:{ref}:{path}`
  - `github:tree:{repoId}:{ref}`
  - `github:resolve:{ref}:{path}`
- **Value Type**: GitHub API response data
- **Storage Backend**: Memory
- **TTL**: Not specified
- **Invalidation**: By git ref change

---

### 15. Config Cache

- **File**: Referenced in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`
- **Key Format**:
  - Virtual FS: `vf:{projectId}:{VERSION}`
  - Local FS: `{projectDir}:{VERSION}`
- **Value Type**: `VeryfrontConfig`
- **Storage Backend**: Memory
- **TTL**: Indefinite (invalidated by version change)
- **Invalidation**: Version bump (`VERSION` constant)

---

### 16. CSS Bundle Cache

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/build/asset-pipeline/css-optimizer/css-bundle-cache.ts`
- **Key Format**: File path as key
- **Value Type**: `CSSBundle { content, sourceMap?, size, minifiedSize, hash }`
- **Storage Backend**: Memory Map
- **TTL**: Build lifetime
- **Invalidation**: `clear()` or new build

---

### 17. Render Cache Coordinator (Legacy)

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/cache/cache-coordinator.ts`
- **Key Format**: Page slug
- **Value Type**: `CachePayload { result: RenderResult, storedAt, expiresAt? }`
- **Storage Backend**: Memory LRU (default 100 entries)
- **TTL**: Configurable
- **Invalidation**:
  - `clearSlug(slug)`
  - `clearAll()`

---

### 18. Memory Cache Store (Render)

- **File**: `/Users/mattboon/Sites/veryfront-renderer/src/rendering/cache/stores/memory-store.ts`
- **Key Format**: Cache key string (context-dependent)
- **Value Type**: `CachePayload`
- **Storage Backend**: LRU Memory (default 100 entries)
- **TTL**: Configurable via options
- **Invalidation**:
  - `deleteByPrefix(prefix)` for multi-tenant support
  - LRU eviction

---

## Cache Key Prefixes Reference

Defined in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`:

```typescript
export const CacheKeyPrefix = {
  // Redis prefixes
  SSR_MODULE: "veryfront:ssr-module:",
  FILE_CACHE: "veryfront:file-cache:",
  TRANSFORM: "veryfront:transform:",

  // Memory cache prefixes
  CONFIG: "config",
  CONFIG_VIRTUAL: "vf",

  // File operation prefixes
  FILE: "file",
  STAT: "stat",
  DIR: "dir",
  FILES: "files",

  // GitHub adapter prefixes
  GITHUB_CONTENT: "github:content",
  GITHUB_BYTES: "github:bytes",
  GITHUB_DIR: "github:dir",
  GITHUB_STAT: "github:stat",
  GITHUB_TREE: "github:tree",
  GITHUB_RESOLVE: "github:resolve",

  // Module system prefixes
  MODULE_RESOLVE: "resolve",
  MODULE_PATH: "veryfront",
  SSR_VERSION: "v",

  // Component cache prefixes
  COMPONENT: "component",
  LAYOUT: "layout",

  // Server-side prefixes
  ERROR_PAGE: "error",
  PROXY: "proxy",

  // Project prefixes
  PROJECT: "project",

  // Styles prefixes
  GLOBALS_CSS: "globals",
};
```

---

## TTL Configuration Summary

### Production TTLs

| Cache | TTL | Source |
|-------|-----|--------|
| SSR Module (Distributed) | 6 hours | `DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC` |
| Transform (Distributed) | 6 hours | `DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC` |
| File (Distributed) | 1 hour | `DISTRIBUTED_FILE_TTL_PRODUCTION_SEC` |
| CSS (Distributed) | 6 hours | `DISTRIBUTED_CSS_TTL_PRODUCTION_SEC` |
| HTTP Module | 24 hours | `HTTP_MODULE_DISTRIBUTED_TTL_SEC` |
| MDX Bundle | 7 days | `BUNDLE_MANIFEST_PROD_TTL_MS` |

### Preview/Development TTLs

| Cache | TTL | Source |
|-------|-----|--------|
| SSR Module (Distributed) | 10 minutes | `DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC` |
| Transform (Distributed) | 10 minutes | `DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC` |
| File (Distributed) | 5 minutes | `DISTRIBUTED_FILE_TTL_PREVIEW_SEC` |
| CSS (Distributed) | 10 minutes | `DISTRIBUTED_CSS_TTL_PREVIEW_SEC` |
| MDX Bundle | 1 hour | `BUNDLE_MANIFEST_DEV_TTL_MS` |

### Memory Cache TTLs

| Cache | TTL | Max Entries |
|-------|-----|-------------|
| Component Loader | 10 min | 200 |
| MDX Renderer | 10 min | 500 |
| Renderer Core | 5 min | 200 |
| TSX Layout | 10 min | 100 |
| Data Fetching | 10 min | 500 |
| Module Cache | 5 min | 10000 |
| ESM Cache | 10 min | 5000 |
| SSR Module Memory | 30 min | 500 |

---

## Issues and Risks

### 1. Key Collision Risks

**CRITICAL: Transform Cache Not Project-Scoped**

The transform cache key format is:
```
v{version}:{filePath}:{contentHash}:{ssr|browser}[:studio]
```

This does NOT include project ID. If two projects have the same file path with the same content hash, they would share the same cache entry. This is intentional (content-addressed caching) but could cause issues if:
- Different projects need different transforms for the same content
- Environment-specific transforms are needed

**Mitigation**: The content hash should be different if the content differs. However, if transforms depend on project configuration, this could be a bug source.

---

### 2. Missing Project Scoping

The following caches are NOT project-scoped and could cause cross-project contamination:

| Cache | Risk Level | Notes |
|-------|------------|-------|
| Transform Cache | Medium | Content-hash based, but no project isolation |
| HTTP Module Cache | Low | URL-hash based, typically same for all projects |
| Agent Cache | Medium | Input-hash only, no project context |
| React Version Cache | High (by design) | Uses projectDir as key |

---

### 3. Inconsistent Key Formats

**Different Separator Styles**:
- Some use `:` (file:env:project:qualifier)
- Some use `::` (pathname::params in data fetching)
- Some use `-` (theme-light, release-{id})

**Version Inclusion Inconsistency**:
- Render cache includes `VERSION`
- Transform cache uses `TRANSFORM_CACHE_VERSION`
- File cache does NOT include version
- SSR module uses `v{version}` prefix

---

### 4. TTL Mismatches Between Related Caches

**HTTP Module vs Transform TTL Mismatch**:
- HTTP Module: 24 hours
- Transform: 5 minutes (default) or 24 hours (distributed)
- SSR Module: 6 hours (production)

If a transform references an HTTP module that expires, the transform becomes invalid but may still be cached.

**Mitigation in code**: HTTP module cache has TTL refresh logic (every 4 hours) to keep bundles alive longer than transforms.

---

### 5. Environment Path Contamination

**File Path in HTTP Module Cache**:
Cached HTTP modules contain `file://` paths that are environment-specific:
- Local dev: `/Users/mattboon/.cache/veryfront-http-bundle/...`
- Production: `/app/.cache/veryfront-http-bundle/...`

**Mitigation**: `hasIncompatibleFilePaths()` function checks and invalidates mismatched paths.

---

### 6. Memory Leak Potential

Caches without TTL or max entries:
- `globalInProgress` Map (no TTL, but should clear after transform)
- `failedComponents` Map (no cleanup mechanism visible)
- React Version Cache (indefinite, cleared only manually)
- Module Path Cache index (survives restarts)

---

### 7. Cache Invalidation Gaps

**File Cache Backend Invalidation**:
When invalidating file cache by prefix, both memory and backend need clearing:
```typescript
// Fire-and-forget backend deletion
cacheBackend?.delByPattern?.(`${prefix}*`).catch((error) => {
  logger.debug("[FileCache] Backend invalidation failed", { prefix, error });
});
```

This fire-and-forget approach could leave stale entries in backend if:
- Backend temporarily unavailable
- Pattern matching fails

---

## Recommendations

### 1. Standardize Key Format

Create a unified key format:
```
{namespace}:{version}:{projectId}:{environment}:{qualifier}:{resource}
```

### 2. Add Version to All Cache Keys

Ensure all cache keys include framework version to auto-invalidate on deploy:
```typescript
function buildCacheKey(parts: string[]): string {
  return [VERSION, ...parts].join(':');
}
```

### 3. Unified TTL Configuration

Create environment-aware TTL getters for all cache types:
```typescript
function getCacheTTL(cacheType: CacheType, isProduction: boolean): number {
  // Centralized TTL management
}
```

### 4. Circuit Breaker for All Backend Caches

Apply the ResilientCache pattern (from proxy) to all distributed caches:
- File Cache
- Transform Cache
- SSR Module Cache

### 5. Cache Registry Enhancement

Extend cache registry to track:
- Cache hit/miss rates
- Memory usage per cache
- Backend latency
- Invalidation events

### 6. Documentation Comments

Add cache key format documentation as JSDoc comments to all key builders.

---

## Related Files

| File | Purpose |
|------|---------|
| `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts` | Central key builders |
| `/Users/mattboon/Sites/veryfront-renderer/src/cache/backend.ts` | Backend abstraction |
| `/Users/mattboon/Sites/veryfront-renderer/src/cache/registry.ts` | Cache registration |
| `/Users/mattboon/Sites/veryfront-renderer/src/cache/module-cache.ts` | Pod-level module cache |
| `/Users/mattboon/Sites/veryfront-renderer/src/utils/constants/cache.ts` | TTL constants |
| `/Users/mattboon/Sites/veryfront-renderer/src/server/context/cache-invalidation.ts` | Invalidation orchestration |
