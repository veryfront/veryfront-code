# Chapter 3: Cache HIT vs MISS Behavior Differences

## Overview

This document catalogs all caching systems in the veryfront-renderer codebase and documents the critical behavioral differences between cache HITs (returning cached data) and cache MISSes (fetching/computing fresh data). These differences are a major source of production bugs.

## Executive Summary: The Core Problem

**Cache hits skip validation and transformation that cache misses perform.**

When data is cached:
- No content validation occurs
- No environment compatibility checks (in some caches)
- No freshness verification beyond TTL
- File paths may reference non-existent locations (cross-environment)

This asymmetry means bugs only surface on cache misses (cold starts, pod restarts, TTL expiry), making them hard to reproduce and debug.

---

## Sub-Analyses

| Document | Issue | Severity |
|----------|-------|----------|
| [003.0 - Cache Consistency RFC](./003.0-cache-consistency-rfc.md) | Unified solution architecture | RFC |
| [003.1 - SSR Module Path Mismatch](./003.1-ssr-module-path-mismatch.md) | Cross-pod file:// paths break | CRITICAL |
| [003.2 - HTTP Bundle TTL Mismatch](./003.2-http-bundle-ttl-mismatch.md) | Transforms outlive dependencies | HIGH |
| [003.3 - Multi-tenancy Cache Isolation](./003.3-multitenancy-cache-isolation.md) | Cross-project data leakage | CRITICAL |
| [003.4 - Cache Hit Validation Skipped](./003.4-cache-hit-validation-skipped.md) | Stale content served | HIGH |

---

## Cache Systems Inventory

| Cache System | Location | Key Format | TTL (Prod) | TTL (Preview) |
|--------------|----------|------------|------------|---------------|
| SSR Module Cache | `src/modules/react-loader/ssr-module-loader/` | `vN:ssr-modules:{projectId}:{path}` | 6 hours | 10 min |
| HTTP Bundle Cache | `src/transforms/esm/http-cache.ts` | `url:{hash}` | 24 hours | 24 hours |
| Transform Cache | `src/transforms/esm/transform-cache.ts` | `transform:v{N}:{hash}` | 24 hours | 10 min |
| File Cache | `src/platform/adapters/fs/cache/file-cache.ts` | `{projectSlug}:{contentSourceId}:{path}` | 5 min | 5 min |
| Multi-Tier Cache | `src/cache/multi-tier.ts` | Configurable | Configurable | Configurable |
| Context-Aware Cache | `src/rendering/shared/context-aware-cache.ts` | `{projectId}:{env}:{slug}` | Configurable | Configurable |
| MDX-ESM Cache | `src/transforms/mdx/esm-module-loader/cache/` | `v{N}:_vf_modules/{path}` | Persistent | Persistent |
| Tailwind CSS Cache | `src/html/styles-builder/tailwind-compiler.ts` | `css:{hash}` | 6 hours | 10 min |
| Request Cache Batcher | `src/cache/request-cache-batcher.ts` | Per-request scoped | Request lifetime | Request lifetime |

---

## 1. SSR Module Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/`

### Cache Key Format

```typescript
// src/cache/keys.ts:14-19
export function buildSSRModuleCacheKey(
  version: number,
  projectId: string,
  key: string,
): string {
  return `v${version}:ssr-modules:${projectId}:${key}`;
}

// loader.ts:259-272
private getCacheKey(filePath: string): string {
  const reactVersion = this.options.reactVersion ?? "default";
  return buildSSRModuleCacheKey(
    TRANSFORM_CACHE_VERSION,
    this.options.projectId,
    `${this.options.contentSourceId}:${reactVersion}:${filePath}`,
  );
}
```

### Cache HIT Behavior (What Code is SKIPPED)

```typescript
// loader.ts:450-491 - Memory cache hit
const cachedEntry = globalModuleCache.get(contentCacheKey);
if (cachedEntry) {
  // SKIPPED: Full transform pipeline
  // SKIPPED: Dependency parsing
  // SKIPPED: Cross-project import resolution

  // PERFORMED: HTTP bundle verification (partial)
  const verifyKey = `${cachedEntry.tempPath}:${cachedEntry.contentHash}`;
  if (!verifiedHttpBundlePaths.get(verifyKey)) {
    // Check if HTTP bundles still exist
    const bundlePaths = extractHttpBundlePaths(cachedCode);
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);
    // If bundles missing, invalidate and fall through
  }

  // Return cached temp path directly
  globalModuleCache.set(filePathCacheKey, cachedEntry);
  await this.ensureDependenciesExist(code, filePath, depth);
  return;
}
```

**Redis cache hit (lines 493-540):**
```typescript
if (isSSRDistributedCacheEnabled()) {
  const redisCode = await getFromRedis(contentCacheKey);
  if (redisCode) {
    // SKIPPED: esbuild transform
    // SKIPPED: Local import parsing
    // SKIPPED: Cross-project fetching

    // PERFORMED: HTTP bundle existence check
    const bundlePaths = extractHttpBundlePaths(redisCode);
    const failed = await ensureHttpBundlesExist(bundlePaths, cacheDir);

    // CRITICAL: Uses transformedHash, not contentHash
    // This can cause path mismatch if done wrong
    const transformedHash = await this.hashContentAsync(redisCode);
    const tempPath = await this.getTempPath(filePath, transformedHash);

    // Write to local filesystem
    await this.fs.writeTextFile(tempPath, redisCode);
  }
}
```

### Cache MISS Behavior (What Code RUNS)

```typescript
// loader.ts:602-730 - Full transform path
// 1. Parse all local imports
const parseResult = await parseLocalImports(code, filePath, projectDir, adapter);

// 2. Process all dependencies recursively
const localImportPaths = await this.processLocalImports(
  parseResult.imports, filePath, depth, localFs
);

// 3. Fetch and transform cross-project imports
for (const crossImport of parseResult.crossProjectImports) {
  const tempPath = await this.transformCrossProjectImport(crossImport);
  crossProjectPaths.set(crossImport.specifier, tempPath);
}

// 4. Transform via esbuild
let transformed = await transformToESM(code, filePath, projectDir, adapter, transformOpts);

// 5. Rewrite imports to hashed paths
transformed = this.rewriteCrossProjectImport(transformed, specifier, tempPath);
transformed = this.rewriteLocalImports(transformed, localImportPaths, filePath);

// 6. Ensure HTTP bundles exist
const bundlePaths = extractHttpBundlePaths(transformed);
await ensureHttpBundlesExist(bundlePaths, cacheDir);

// 7. Write to temp file with hashed name
const transformedHash = await this.hashContentAsync(transformed);
const tempPath = await this.getTempPath(filePath, transformedHash);
await this.fs.writeTextFile(tempPath, transformed);

// 8. Store in Redis for cross-pod sharing
if (isSSRDistributedCacheEnabled()) {
  setInRedis(contentCacheKey, transformed, { isProduction });
}

// 9. Store in memory cache
const entry: ModuleCacheEntry = { tempPath, contentHash: transformedHash };
globalModuleCache.set(contentCacheKey, entry);
```

### Validation Differences

| Aspect | Cache HIT | Cache MISS |
|--------|-----------|------------|
| Content hash verification | No (trusted) | Yes (computed) |
| HTTP bundle existence | Checked once per path | Always checked |
| Import path validity | No validation | Full parsing |
| Cross-project availability | No validation | Fetched and validated |
| Transform syntax errors | Not caught | Caught by esbuild |

### What Can Go Wrong

1. **Environment Path Mismatch (Critical)**
   - Cached code contains `file://` paths from a different environment
   - Example: Redis cached `/tmp/abc123/module.js` from Pod A
   - Pod B reads cache, but `/tmp/abc123/` doesn't exist locally
   - Result: "Module not found" at runtime

2. **HTTP Bundle TTL Mismatch**
   - HTTP bundles have 24-hour Redis TTL
   - SSR transforms have 6-hour Redis TTL
   - Transform cached longer than its HTTP bundle dependencies
   - Result: Import fails for cached transform

3. **Stale Dependency Graph**
   - Cached transform references old import paths
   - Source file changed, added new dependency
   - Cached code still works but with wrong imports

---

## 2. HTTP Bundle Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/http-cache.ts`

### Cache Key Format

```typescript
// http-cache.ts:91-95
function getCachePath(url: string, cacheDir: string): { hash: string; path: string } {
  const hash = hashCodeHex(normalizeUrl(url));
  return { hash, path: join(cacheDir, `http-${hash}.mjs`) };
}
```

### Cache HIT Behavior

```typescript
// http-cache.ts:130-156 - Local filesystem hit
const stat = await fs.stat(cachePath);
if (stat?.isFile) {
  // SKIPPED: Network fetch
  // SKIPPED: Content transformation
  // SKIPPED: gzip decompression (if applicable)

  // Return file:// path directly
  return `file://${cachePath}`;
}

// http-cache.ts:293-310 - Distributed cache hit
const cachedCode = await distributed.get(`url:${hash}`);
if (cachedCode) {
  // SKIPPED: Network fetch
  // PERFORMED: Write to local filesystem
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeTextFile(cachePath, cachedCode);
  return `file://${cachePath}`;
}
```

### Cache MISS Behavior

```typescript
// http-cache.ts:160-240 - Full fetch path
// 1. Resolve esm.sh URL
const resolvedUrl = await resolveEsmUrl(url);

// 2. Fetch with retries
const response = await fetchWithRetry(resolvedUrl);

// 3. Handle gzip encoding
let code = response.headers.get("content-encoding") === "gzip"
  ? await decompressGzip(await response.arrayBuffer())
  : await response.text();

// 4. Transform if needed (JSX, etc.)
if (needsTransform(code)) {
  code = await transformBundle(code, url);
}

// 5. Write to local cache
await fs.mkdir(cacheDir, { recursive: true });
await fs.writeTextFile(cachePath, code);

// 6. Store in distributed cache
if (distributed) {
  await distributed.set(`url:${hash}`, code, HTTP_MODULE_DISTRIBUTED_TTL_SEC);
}
```

### What Can Go Wrong

1. **Gzip-encoded Content in Cache**
   - Some bundles fetched with gzip encoding
   - If decompression fails, raw gzip stored in cache
   - Cache hit returns binary gzip as "JavaScript"
   - Result: Syntax error on import

2. **esm.sh Redirect Not Followed**
   - esm.sh returns redirect for version resolution
   - Cached URL may be pre-redirect
   - Different pods may cache different resolved URLs
   - Result: Version inconsistency

---

## 3. Transform Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/transform-cache.ts`

### Cache Key Format

```typescript
// transform-cache.ts - key construction
const key = `transform:v${TRANSFORM_CACHE_VERSION}:${hashCodeHex(content)}`;
```

### Cache HIT Behavior

```typescript
// On cache hit, return transformed code directly
// SKIPPED: esbuild invocation
// SKIPPED: Import rewriting
// SKIPPED: JSX transformation
const cached = await transformCache.get(key);
if (cached) return cached;
```

### Cache MISS Behavior

```typescript
// Full esbuild transform
const result = await esbuild.transform(code, {
  loader: getLoader(filePath),
  jsx: 'automatic',
  jsxImportSource: 'react',
  format: 'esm',
  target: 'esnext',
  sourcemap: false,
});

// Store result
await transformCache.set(key, result.code, ttlSeconds);
return result.code;
```

### What Can Go Wrong

1. **React Version Mismatch**
   - Transform uses hardcoded React JSX runtime
   - Project may specify different React version
   - Cached transform has wrong import source

---

## 4. File Cache (VeryfrontFSAdapter)

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/cache/file-cache.ts`

### Cache Key Format

```typescript
// file-cache.ts - key from context
const cacheKey = `${projectSlug}:${contentSourceId}:${normalizedPath}`;
```

### Cache HIT Behavior

```typescript
// file-cache.ts:180-194
async get(key: string): Promise<string | null> {
  const entry = this.memoryCache.get(key);
  if (entry) {
    // SKIPPED: API fetch
    // SKIPPED: Content validation
    // NO TTL CHECK on memory cache (relies on backend TTL)
    this.hits++;
    return entry.value;
  }

  // Try backend (Redis/API)
  const backendValue = await this.backend.get(key);
  if (backendValue) {
    // Backfill to memory
    this.memoryCache.set(key, { value: backendValue, timestamp: Date.now() });
    return backendValue;
  }

  this.misses++;
  return null;
}
```

### Cache MISS Behavior

```typescript
// read-operations.ts:260-350
// 1. Fetch from Veryfront API
const response = await this.fetchFromAPI(path);

// 2. Validate response
if (!response.ok) throw new Error(`File not found: ${path}`);

// 3. Parse content
const content = await response.text();

// 4. Store in cache
await this.cache.set(cacheKey, content, DISTRIBUTED_FILE_TTL);

return content;
```

### Validation Differences

| Aspect | Cache HIT | Cache MISS |
|--------|-----------|------------|
| File existence | Assumed | Verified via API |
| Content freshness | TTL only | Always fresh |
| API error handling | N/A | Full error handling |
| Content type validation | None | Checked |

### What Can Go Wrong

1. **Stale Content After Publish**
   - File updated in Studio
   - Cache not invalidated (POKE missed)
   - Old content served until TTL expires

2. **Negative Caching Gap**
   - File deleted, cache not cleared
   - Returns stale content
   - Or: file-not-found not cached, repeated API hits

---

## 5. Multi-Tier Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/cache/multi-tier.ts`

### Architecture

```
L1 (Request) -> L2 (Memory) -> L3 (Distributed)
     ^              ^               ^
     |              |               |
  1ms TTL       5min TTL        6hr TTL
```

### Cache HIT Behavior (by tier)

```typescript
// multi-tier.ts:150-215
async get(key: string): Promise<T | null> {
  // L1 check (request-scoped)
  if (this.config.l1) {
    const value = await this.config.l1.get(key);
    if (value !== null) {
      this.stats.l1Hits++;
      span?.setAttribute("cache.hit_tier", "l1");
      return value;
      // SKIPPED: L2, L3 checks
    }
  }

  // L2 check (memory)
  if (this.config.l2) {
    const value = await this.config.l2.get(key);
    if (value !== null) {
      this.stats.l2Hits++;
      span?.setAttribute("cache.hit_tier", "l2");
      // PERFORMED: Backfill to L1
      this.backfill(key, value, ["l1"]);
      return value;
      // SKIPPED: L3 check
    }
  }

  // L3 check (distributed)
  if (this.config.l3) {
    const value = await this.config.l3.get(key);
    if (value !== null) {
      this.stats.l3Hits++;
      span?.setAttribute("cache.hit_tier", "l3");
      // PERFORMED: Backfill to L1, L2
      this.backfill(key, value, ["l1", "l2"]);
      return value;
    }
  }

  this.stats.misses++;
  return null;
}
```

### What Can Go Wrong

1. **Tier TTL Mismatch**
   - L3 has longer TTL than L2
   - Value expires from L2, re-fetched from L3
   - L3 value may be stale relative to source

2. **Backfill Race Condition**
   - L3 hit triggers backfill to L1, L2
   - Concurrent request updates source
   - Backfill writes stale value to L1, L2

---

## 6. MDX-ESM Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/esm-module-loader/cache/`

### Cache Key Format

```typescript
// cache/index.ts:186-200
function toMdxEsmCacheKey(filePath: string, projectDir?: string): string {
  let relativePath = filePath;
  if (projectDir && filePath.startsWith(projectDir)) {
    relativePath = filePath.slice(projectDir.length).replace(/^\/+/, "");
  }
  relativePath = relativePath.replace(/^\/+/, "");
  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js");
  return `v${TRANSFORM_CACHE_VERSION}:_vf_modules/${jsPath}`;
}
```

### Cache HIT Behavior

```typescript
// cache/index.ts:215-273 - lookupMdxEsmCache
export async function lookupMdxEsmCache(
  filePath: string,
  cacheDir: string,
  projectDir?: string,
  _contentHash?: string, // INTENTIONALLY UNUSED
): Promise<string | null> {
  const cache = await getModulePathCache(cacheDir);
  const cacheKey = toMdxEsmCacheKey(filePath, projectDir);

  const cachedPath = cache.get(cacheKey);
  if (!cachedPath) return null;

  // Verify file exists
  const stat = await getLocalFs().stat(cachedPath);
  if (!stat?.isFile) {
    cache.delete(cacheKey);
    return null;
  }

  // CRITICAL: Check for incompatible HTTP bundle paths
  const cachedCode = await getLocalFs().readTextFile(cachedPath);
  if (hasIncompatibleHttpPaths(cachedCode)) {
    // Paths from different environment - invalidate
    cache.delete(cacheKey);
    await getLocalFs().remove(cachedPath);
    return null;
  }

  // NOTE: contentHash validation SKIPPED
  // Reason: MDX-ESM uses transformed-code hashes, SSR uses source-code hashes
  // These will never match, so validation is skipped

  return cachedPath;
}
```

**Key validation code (lines 27-42):**
```typescript
function hasIncompatibleHttpPaths(code: string): boolean {
  const localHttpCacheDir = getHttpBundleCacheDir();
  const pattern = new RegExp(FILE_PATH_PATTERN.source, "gi");
  let match;
  while ((match = pattern.exec(code)) !== null) {
    const path = match[1] as string;
    if (path.includes("veryfront-http-bundle") && !path.startsWith(localHttpCacheDir)) {
      // Path from different environment
      return true;
    }
  }
  return false;
}
```

### What Can Go Wrong

1. **Content Hash Intentionally Skipped**
   - Comment at line 255-261 explains why
   - Source hash vs transformed hash mismatch
   - Stale content possible if version bump missed

2. **Path Compatibility Only Partial**
   - Only checks `veryfront-http-bundle` paths
   - Other `file://` paths not validated
   - Could have stale local imports

---

## 7. Context-Aware Cache

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/rendering/shared/context-aware-cache.ts`

### Cache Key Format

```typescript
// context-aware-cache.ts:203-211
private getCacheKey(slug: string, ctx: RenderContext, colorScheme?: string): string {
  const themeKey = colorScheme ? `:theme-${colorScheme}` : "";
  return createCacheKey(ctx, `page:${slug}${themeKey}`);
}

// render-context.ts - createCacheKey
export function createCacheKey(ctx: RenderContext, suffix: string): string {
  return `${ctx.cachePrefix}:${suffix}`;
  // cachePrefix = `${projectId}:${environment}:${contentSourceId}`
}
```

### Cache HIT Behavior

```typescript
// context-aware-cache.ts:41-99
async checkCache(slug, ctx, colorScheme): Promise<CacheLookupResult> {
  const cacheKey = this.getCacheKey(slug, ctx, colorScheme);
  const cached = await this.store.get(cacheKey) as CachePayload | undefined;

  if (!cached) {
    return { cacheKey, hit: false };
  }

  // TTL check
  if (this.isExpired(cached)) {
    await this.store.delete(cacheKey);
    return { cacheKey, hit: false };
  }

  // SKIPPED: Full render pipeline
  // SKIPPED: Component loading
  // SKIPPED: Data fetching
  // SKIPPED: HTML generation

  return {
    cachedResult: this.cloneResult(cached.result),
    cacheKey,
    hit: true,
  };
}

private isExpired(entry: CachePayload): boolean {
  return typeof entry.expiresAt === "number" && Date.now() > entry.expiresAt;
}
```

### Cache MISS Behavior

Full render pipeline executes:
1. Route resolution
2. Component loading (SSR module loader)
3. Data fetching (getStaticData, etc.)
4. React SSR
5. HTML serialization
6. CSS generation

### What Can Go Wrong

1. **Stream Results Not Cached**
   - `persistResult` skips if `result.stream` exists
   - Streaming responses never cached
   - Repeated full renders for streaming pages

---

## 8. TTL Inconsistencies

**Location:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/constants/cache.ts`

### TTL Values Summary

```typescript
// Production TTLs
DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC = 6 hours
DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC = 6 hours
DISTRIBUTED_FILE_TTL_PRODUCTION_SEC = 1 hour
DISTRIBUTED_CSS_TTL_PRODUCTION_SEC = 6 hours
HTTP_MODULE_DISTRIBUTED_TTL_SEC = 24 hours
TRANSFORM_DISTRIBUTED_TTL_SEC = 24 hours

// Preview TTLs
DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC = 10 min
DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC = 10 min
DISTRIBUTED_FILE_TTL_PREVIEW_SEC = 5 min
DISTRIBUTED_CSS_TTL_PREVIEW_SEC = 10 min

// Memory TTLs
MODULE_CACHE_TTL_MS = 5 min
ESM_CACHE_TTL_MS = 10 min
MDX_RENDERER_TTL_MS = 10 min
RENDERER_CORE_TTL_MS = 5 min
```

### Critical TTL Mismatch

**HTTP Bundles (24h) vs SSR Transforms (6h):**
- SSR transform references HTTP bundle by `file://` path
- HTTP bundle expires from Redis after 24h
- SSR transform still valid for 6h
- But: HTTP bundle path in transform points to non-existent file
- Pod restart loses local HTTP bundle file
- Transform fetched from Redis, HTTP bundle not in Redis
- Result: "Module not found" for HTTP import

---

## Summary: HIT vs MISS Behavioral Matrix

| Cache | HIT: Validates Content? | HIT: Validates Paths? | HIT: Validates Deps? | MISS: Full Pipeline? |
|-------|------------------------|----------------------|---------------------|---------------------|
| SSR Module | No | Partial (HTTP only) | Partial | Yes |
| HTTP Bundle | No | N/A | N/A | Yes |
| Transform | No | No | No | Yes |
| File Cache | No | N/A | N/A | Yes |
| Multi-Tier | No | No | No | Yes |
| MDX-ESM | No | Yes (HTTP paths) | No | Yes |
| Context-Aware | TTL only | No | No | Yes |

---

## Success Criteria: Unified Cache Behavior

### Must Have

1. **Consistent Validation on HIT**
   - [ ] All caches validate file:// paths exist before returning
   - [ ] All caches check environment compatibility (cache dir prefix)
   - [ ] All caches verify content hash matches (where applicable)

2. **TTL Alignment**
   - [ ] Dependent cache TTLs are shorter than their dependencies
   - [ ] SSR transform TTL <= HTTP bundle TTL
   - [ ] File cache TTL <= content source TTL

3. **Path Portability**
   - [ ] No hardcoded file:// paths in distributed cache
   - [ ] Use relative paths or re-resolve on cache hit
   - [ ] Or: validate and invalidate incompatible paths

4. **Graceful Degradation**
   - [ ] Cache hit with invalid content falls back to miss path
   - [ ] No runtime errors from stale cache data
   - [ ] Clear error messages when cache invalidation needed

### Should Have

5. **Unified Cache Interface**
   - [ ] All caches implement same validation hooks
   - [ ] Consistent TTL configuration mechanism
   - [ ] Shared path validation utility

6. **Observability**
   - [ ] Metrics distinguish hit/miss by validation failure reason
   - [ ] Traces show which cache tier served the response
   - [ ] Alerts on high cache invalidation rates

### Nice to Have

7. **Proactive Validation**
   - [ ] Background job validates cached entries
   - [ ] Pre-warm caches on deploy
   - [ ] Dependency graph tracking for cascade invalidation

---

## Recommended Fixes (Priority Order)

### P0: Critical

1. **Add path validation to all cache HITs**
   - Before returning cached transform, verify all file:// paths exist
   - If any path invalid, invalidate cache entry and fall through to miss

2. **Align HTTP bundle and transform TTLs**
   - HTTP bundle TTL should be >= transform TTL
   - Or: transforms should re-verify HTTP bundles on every hit

### P1: High

3. **Content hash validation on cache hit**
   - Store source content hash with cached transform
   - On hit, verify source hasn't changed (especially for preview)

4. **Unified cache validation layer**
   - Extract common validation logic
   - Apply consistently across all cache systems

### P2: Medium

5. **Relative path storage**
   - Store relative paths in distributed cache
   - Resolve to absolute paths on cache hit
   - Eliminates cross-environment path issues

6. **Cache warming on pod start**
   - Pre-fetch critical transforms on startup
   - Reduces cold-start latency
   - Ensures consistent state across pods
