# Bundle Dependency Tracking

## Executive Summary

The veryfront-renderer transform and bundle caching system has a critical gap: **dependencies are not tracked in cache keys**. When a dependency file changes but the main file doesn't, stale bundles are served because the cache key only includes the main file's content hash.

The `BundleMetadata.meta.depsHash` field is **DEFINED but NEVER USED** in cache key generation. This document analyzes the problem, demonstrates the bug scenario, and proposes solutions.

---

## Sub-Analyses

| Document | Severity | Issue |
|----------|----------|-------|
| [004.0 - RFC](./004.0-dependency-tracking-rfc.md) | - | Content-Addressed Dependency Tracking |
| [004.1](./004.1-transform-cache-no-deps-hash.md) | CRITICAL | Transform cache keys missing dependency hash |
| [004.2](./004.2-unused-depshash-infrastructure.md) | MEDIUM | Unused depsHash infrastructure |
| [004.3](./004.3-mdx-import-tracking-gap.md) | HIGH | MDX import tracking gap |
| [004.4](./004.4-npm-esm-package-version-drift.md) | HIGH | npm/esm.sh package version drift |
| [004.5](./004.5-ssr-module-loader-staleness.md) | HIGH | SSR module loader cache staleness |
| [004.6](./004.6-config-changes-not-invalidating.md) | MEDIUM | Config changes not invalidating transforms |

---

## 1. The Problem

### Current Cache Key Format

Transform cache keys are generated in `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`:

```typescript
// Line 260-269
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

**Key components:**
- `TRANSFORM_CACHE_VERSION` (currently 18) - global version, bumped when transform logic changes
- `filePath` - the source file path
- `contentHash` - hash of the **main file's content only**
- `ssr` - SSR vs browser target
- `studioEmbed` - studio embedding flag

**Missing from cache key:**
- Hash of dependencies
- Dependency file paths
- Transitive dependency information

### Where Cache Keys Are Used

1. **Transform Pipeline** (`/Users/mattboon/Sites/veryfront-renderer/src/transforms/pipeline/index.ts:69-76`):
   ```typescript
   const cacheKey = generateCacheKey(
     filePath,
     ctx.contentHash,  // Only the main file's hash
     options.ssr ?? false,
     options.studioEmbed ?? false,
   );

   const cached = await getCachedTransformAsync(cacheKey);
   if (cached) {
     return {
       code: cached.code,
       // ...returns cached code without checking dependencies
     };
   }
   ```

2. **Legacy Transform Core** (`/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/legacy/transform-core.ts:43-45`):
   ```typescript
   const cacheKey = generateCacheKey(filePath, contentHash, ssr);
   const cached = getCachedTransform(cacheKey);
   if (cached) return cached.code;  // No dependency validation
   ```

3. **SSR Module Loader** (`/Users/mattboon/Sites/veryfront-renderer/src/modules/react-loader/ssr-module-loader/loader.ts:259-272`):
   ```typescript
   private getCacheKey(filePath: string): string {
     // ...
     return buildSSRModuleCacheKey(
       TRANSFORM_CACHE_VERSION,
       this.options.projectId,
       `${this.options.contentSourceId}:${reactVersion}:${filePath}`,
     );
   }
   ```
   Note: Uses `filePath` but **not** content hash or dependency hash.

---

## 2. The Unused depsHash Field

### Definition

In `/Users/mattboon/Sites/veryfront-renderer/src/utils/bundle-manifest.ts`:

```typescript
// Lines 3-17
export interface BundleMetadata {
  hash: string;
  codeHash: string;
  size: number;
  compiledAt: number;
  source: string;
  mode: "development" | "production";
  meta?: {
    type?: "mdx" | "component" | "layout" | "provider";
    depsHash?: string;           // <-- DEFINED BUT NEVER USED
    reactVersion?: string;
    headings?: Array<{ id: string; text: string; level: number }>;
  };
}
```

### Also Defined in Layout Types

In `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/types.ts`:

```typescript
// Lines 7-10
export interface NestedLayoutsResult {
  nestedLayouts: LayoutItem[];
  depsHash: string;              // <-- DEFINED BUT NOT USED IN CACHING
}
```

### A Hash Calculator Exists But Is Not Connected

In `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/utils/hash-calculator.ts`:

```typescript
// Lines 5-45
export async function computeDepsHash(
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  adapter: RuntimeAdapter,
): Promise<string> {
  try {
    const hashPromises: Promise<string>[] = [];

    if (layoutBundle) {
      hashPromises.push(computeHash(String(layoutBundle.compiledCode ?? "")));
    }

    for (const item of nestedLayouts) {
      if (!item) continue;

      if (item.componentPath) {
        hashPromises.push(
          adapter.fs
            .readFile(item.componentPath)
            .then((src) => computeHash(src))
            // ...
        );
        continue;
      }
      // ...
    }

    const depParts = await Promise.all(hashPromises);
    return depParts.filter(Boolean).join(":");
  } catch (e) {
    // ...
    return "";
  }
}
```

This function is **exported but never called** in the cache key generation path.

### MDX Cache Adapter Doesn't Set depsHash

In `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/mdx-cache-adapter.ts`:

```typescript
// Lines 107-119
const metadata: BundleMetadata = {
  hash: contentHash,
  codeHash,
  size,
  compiledAt: Date.now(),
  source: filePath ?? "unknown",
  mode: this.mode,
  meta: {
    type: "mdx",
    reactVersion: (await import("react")).version,
    headings: bundle.headings ?? [],
    // NOTE: depsHash is NOT set here
  },
};
```

---

## 3. Bug Scenario: What Happens When a Dependency Changes

### Example Project Structure

```
app/
  components/
    helper.ts         # Exports formatPrice()
  pages/
    products.tsx      # Imports helper.ts
```

### Sequence of Events

**Time T1: Initial Request**
1. User requests `/products`
2. System reads `products.tsx`, computes `contentHash = "abc123"`
3. Cache key: `v18:app/pages/products.tsx:abc123:browser`
4. No cache hit, transforms `products.tsx`
5. Transform includes bundled `helper.ts` with `formatPrice()` implementation v1
6. Caches result with key `v18:app/pages/products.tsx:abc123:browser`

**Time T2: Developer Updates helper.ts**
1. Developer changes `formatPrice()` implementation (v2)
2. Saves `helper.ts` (content hash changes to "def456")
3. Does NOT modify `products.tsx` (content hash remains "abc123")

**Time T3: Subsequent Request**
1. User requests `/products`
2. System reads `products.tsx`, computes `contentHash = "abc123"` (unchanged)
3. Cache key: `v18:app/pages/products.tsx:abc123:browser` (same as T1)
4. **CACHE HIT** - returns stale bundle with `formatPrice()` v1
5. User sees **OLD BEHAVIOR** despite `helper.ts` being updated

### Impact

| Scenario | Expected | Actual |
|----------|----------|--------|
| Dev updates helper file | Fresh build with new code | Stale cached build |
| Bug fix in utility | Fix deployed immediately | Fix not visible until cache expires |
| Shared component update | All pages get update | Only modified pages get update |
| Layout template change | All child pages re-render | Child pages show old layout |

---

## 4. Current State: What Metadata IS Tracked vs Missing

### Tracked (in various places)

| Field | Location | Used in Cache Key? |
|-------|----------|-------------------|
| `contentHash` | Transform cache | Yes |
| `TRANSFORM_CACHE_VERSION` | Global | Yes |
| `filePath` | All caches | Yes |
| `ssr` flag | Transform | Yes |
| `projectId` | SSR loader | Yes |
| `contentSourceId` | SSR loader | Yes |
| `reactVersion` | SSR loader, MDX | Yes (SSR only) |
| `codeHash` | Bundle manifest | No (validation only) |
| `compiledAt` | Bundle manifest | No |
| `mode` | Bundle manifest | No |

### Missing (not tracked anywhere)

| Field | Impact |
|-------|--------|
| **Dependency hashes** | Stale bundles when deps change |
| **Import graph** | Cannot invalidate dependents |
| **Transitive deps** | Deep dependency changes missed |
| **Package versions** | npm/esm.sh updates not detected |

---

## 5. Evidence of Intentional Design for depsHash

The presence of `depsHash` in multiple interfaces suggests it was intended to be used:

1. **BundleMetadata.meta.depsHash** - Clearly designed for dependency tracking
2. **NestedLayoutsResult.depsHash** - Layout system expected to track deps
3. **computeDepsHash() function** - Implementation exists, just not connected

The infrastructure is partially built but the wiring is incomplete.

---

## 6. Success Criteria for Proper Dependency Tracking

A correct implementation must satisfy:

1. **Cache Miss on Dependency Change**
   - When `helper.ts` changes, `products.tsx` cache should miss
   - All files importing `helper.ts` should rebuild

2. **Transitive Invalidation**
   - If A imports B, B imports C, and C changes:
     - Both A and B should miss cache

3. **No Over-Invalidation**
   - Changing `helper.ts` should NOT invalidate unrelated files
   - Only files in the import graph should be affected

4. **Performance Acceptable**
   - Dependency graph computation must be fast (<50ms)
   - Should not require reading all dependency files on every request

5. **Cross-Pod Consistency**
   - Distributed cache (Redis) must handle dependency tracking
   - All pods should compute same cache key for same inputs

### Verification Tests

```typescript
// Test 1: Direct dependency change
- Request /products -> cache miss (first request)
- Request /products -> cache hit
- Modify helper.ts
- Request /products -> cache miss (expected behavior)

// Test 2: Transitive dependency change
- A.tsx imports B.tsx imports C.tsx
- Request /A -> cache miss, cache hit
- Modify C.tsx
- Request /A -> cache miss (expected behavior)

// Test 3: Unrelated file change
- products.tsx and about.tsx exist
- Request /products -> cache miss, cache hit
- Modify about.tsx
- Request /products -> cache hit (should NOT invalidate)
```

---

## 7. Recommended Solution

### Option A: Include Dependency Hash in Cache Key (Recommended)

**Implementation:**

1. **Compute dependency hash during transform:**
   ```typescript
   // In transform pipeline
   async function computeDependencyHash(
     filePath: string,
     adapter: RuntimeAdapter,
     visited = new Set<string>()
   ): Promise<string> {
     if (visited.has(filePath)) return ""; // Circular dep
     visited.add(filePath);

     const content = await adapter.fs.readFile(filePath);
     const imports = parseLocalImports(content);

     const depHashes: string[] = [await computeHash(content)];
     for (const imp of imports.local) {
       depHashes.push(await computeDependencyHash(imp.resolvedPath, adapter, visited));
     }

     return computeHash(depHashes.join(":"));
   }
   ```

2. **Modify cache key generation:**
   ```typescript
   export function buildTransformCacheKey(
     filePath: string,
     contentHash: string,
     depsHash: string,  // NEW
     ssr: boolean = false,
     studioEmbed: boolean = false,
   ): string {
     const ssrKey = ssr ? "ssr" : "browser";
     const studioKey = studioEmbed ? ":studio" : "";
     return `v${TRANSFORM_CACHE_VERSION}:${filePath}:${contentHash}:${depsHash}:${ssrKey}${studioKey}`;
   }
   ```

3. **Update all call sites** (transform pipeline, SSR loader, MDX cache adapter)

**Pros:**
- Cache key uniquely identifies full dependency tree
- Simple conceptual model
- Works with distributed cache

**Cons:**
- Must read all dependencies on every cache lookup
- Performance impact for deep dependency graphs
- May need optimization (parallel reads, metadata cache)

### Option B: Dependency Manifest with Version Tracking

Store a dependency manifest alongside cached transforms:

```typescript
interface DependencyManifest {
  entryFile: string;
  dependencies: {
    [filePath: string]: {
      hash: string;
      mtime?: number;
    }
  };
}
```

On cache lookup:
1. Load manifest
2. Verify all dependency hashes still match
3. If any mismatch, invalidate and re-transform

**Pros:**
- Can short-circuit on first mismatch
- Allows partial validation

**Cons:**
- More complex implementation
- Two-phase lookup (manifest then content)

### Option C: File System Watcher + Invalidation

Use file system events to proactively invalidate:

1. Watch for file changes
2. On change, compute affected files via import graph
3. Invalidate cache entries for affected files

**Pros:**
- No lookup-time performance impact
- Instant invalidation

**Cons:**
- Only works for local development
- Doesn't help distributed cache
- Complex watcher management

---

## 8. Files to Modify

| File | Change Required |
|------|----------------|
| `/src/cache/keys.ts` | Add `depsHash` to `buildTransformCacheKey()` |
| `/src/transforms/pipeline/index.ts` | Compute deps hash before cache lookup |
| `/src/transforms/esm/transform-cache.ts` | Update `generateCacheKey()` signature |
| `/src/transforms/esm/legacy/transform-core.ts` | Update cache key generation |
| `/src/modules/react-loader/ssr-module-loader/loader.ts` | Include deps in cache key |
| `/src/transforms/mdx/mdx-cache-adapter.ts` | Set `depsHash` in metadata |
| `/src/rendering/layouts/utils/hash-calculator.ts` | Connect to cache key generation |
| `/src/utils/bundle-manifest.ts` | Validate `depsHash` on cache read |

---

## 9. Related Issues

- Stale bundles in production after dependency updates
- HMR not reflecting dependency changes correctly
- Cross-pod cache poisoning when transforms differ
- Memory leaks from orphaned cached transforms

---

## 10. References

- `TRANSFORM_CACHE_VERSION` history: `/src/transforms/esm/package-registry.ts:49-70`
- Bundle manifest interface: `/src/utils/bundle-manifest.ts:3-17`
- Layout deps hash calculator: `/src/rendering/layouts/utils/hash-calculator.ts`
- SSR module loader cache: `/src/modules/react-loader/ssr-module-loader/loader.ts`
- Transform pipeline: `/src/transforms/pipeline/index.ts`
