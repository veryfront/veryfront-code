# Chapter 005: App Router vs Pages Router Divergence

## Overview

**Risk Level**: MEDIUM-HIGH
**Files Affected**: ~10 core files
**Dependencies**: Benefits from Chapter 001 (Adapter Interface Unification)

The veryfront-renderer supports two routing paradigms borrowed from Next.js:
- **App Router**: Uses `app/` directory with `page.tsx` convention
- **Pages Router**: Uses `pages/` directory with filename-based routing

These two routers have evolved into parallel implementations with subtle differences, creating maintenance burden and occasional bugs where behavior diverges unexpectedly.

---

## Sub-Analysis Documents

| Document | Severity | Issue |
|----------|----------|-------|
| [005.0 - Router Unification RFC](./005.0-router-unification-rfc.md) | RFC | Complete solution architecture |
| [005.1 - Global Router Detection Cache](./005.1-global-router-detection-cache.md) | HIGH | Global cache causes tenant cross-talk |
| [005.2 - SSG getAllPages() Bug](./005.2-ssg-getallpages-missing-app-router.md) | CRITICAL | App Router pages silently skipped in SSG |
| [005.3 - Duplicated Route Params Extraction](./005.3-duplicated-route-params-extraction.md) | MEDIUM | Two functions with subtle differences |
| [005.4 - Layout Collector Branching](./005.4-layout-collector-router-branching.md) | HIGH | Different layout discovery per router |
| [005.5 - Dynamic Route Inconsistency](./005.5-dynamic-route-handling-inconsistency.md) | HIGH | App Router skips dynamic routes in SSG |

---

## 1. The Problem

### 1.1 Two Parallel Implementations

Every routing operation has two code paths based on router detection:

```
                    +---------------------------------------------+
                    |           INCOMING REQUEST                  |
                    |              /blog/post                     |
                    +---------------------------------------------+
                                       |
                                       v
                              +----------------+
                              | detectAppRouter|
                              |   (cached)     |
                              +----------------+
                                       |
              +------------------------+------------------------+
              |                                                  |
              v                                                  v
    +------------------+                              +------------------+
    |   APP ROUTER     |                              |  PAGES ROUTER    |
    |                  |                              |                  |
    | app/blog/post/   |                              | pages/blog/      |
    |   page.tsx       |                              |   post.tsx       |
    |                  |                              |                  |
    | Different:       |                              | Different:       |
    | - Discovery      |                              | - Discovery      |
    | - Path gen       |                              | - Path gen       |
    | - Layout walk    |                              | - Layout walk    |
    | - Reserved files |                              | - _app.tsx       |
    +------------------+                              +------------------+
```

### 1.2 Why This Matters

1. **Duplicated Logic**: Route discovery, path generation, and layout collection are implemented twice
2. **Subtle Differences**: The two implementations handle edge cases differently
3. **SSG Bug**: The `getAllPages()` method only scans `pages/` directory, missing App Router pages
4. **Maintenance Burden**: Changes must be applied to both code paths
5. **Multi-Tenancy Risk**: Global router detection cache can cause cross-tenant issues

---

## 2. Key Issues Summary

### 2.1 Global Router Detection Cache (005.1)

**Location**: `src/rendering/router-detection.ts:24-27`

```typescript
// GLOBAL MODULE-LEVEL CACHE - shared across all projects!
const routerDetectionCache = new LRUCache<string, boolean>({
  maxEntries: 200,
  ttlMs: 60_000,
});
```

**Impact**: Cache key collisions between projects with same relative paths.

### 2.2 SSG Missing App Router Pages (005.2)

**Location**: `src/rendering/page-resolution/page-resolver.ts:89-113`

```typescript
async getAllPages(): Promise<string[]> {
  // ONLY scans pages/ directory - misses all App Router pages!
  const pagesDir = join(this.projectDir, pagesDirName);
  // ...
  // NO scan of app/ directory!
}
```

**Impact**: SSG silently produces zero pages for App Router projects.

### 2.3 Duplicated Route Params Extraction (005.3)

**Location**: `src/rendering/route-params-extractor.ts`

Two functions with ~150 lines of nearly identical logic:
- `extractAppRouteParams()` - Lines 10-76
- `extractPagesRouteParams()` - Lines 78-156

**Impact**: Subtle behavioral differences, maintenance burden.

### 2.4 Layout Collector Router Branching (005.4)

**Location**: `src/rendering/layouts/layout-collector.ts:257-268`

```typescript
// Different discovery paths based on router AND adapter type
if (isVeryfrontAPI) {
  return await this.collectAPILayoutConfiguration(...);
  // ^ Skips nested layouts entirely!
}
return await this.collectFilesystemLayouts(pageFilePath, useAppRouter);
```

**Impact**: Nested layouts work locally, break in production.

### 2.5 Dynamic Route Handling Inconsistency (005.5)

**Location**: `src/server/build-routes.ts:92-100`

```typescript
// App Router: SKIPS dynamic routes entirely
if (isDynamicSegment(baseName)) return;

// Pages Router: INCLUDES dynamic routes
routes.push({ path: pathForRoute, file: file.path, slug });
```

**Impact**: App Router dynamic routes never get SSG treatment.

---

## 3. Discovery Functions

### 3.1 Router Detection

**File**: `src/rendering/router-detection.ts`

```typescript
// Lines 48-71: Main detection function
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  // Fast path: explicit config
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;

  // Cache check
  const cached = routerDetectionCache.get(projectDir);
  if (cached !== undefined) return cached;

  // Filesystem-based detection
  return await withSpan(...);
}
```

**Problem**: Detection runs per-request (cached for 60s). Projects with both directories can behave unpredictably.

### 3.2 Route Discovery for Dev Server

**File**: `src/server/dev-server/route-discovery.ts`

```typescript
// Lines 44-78: Main discovery loop
async discoverRoutes(): Promise<void> {
  for (const routeDir of routeDirs) {
    if (routeDir.type === "app") {
      await this.discoverAppRoutes(routeDir.path);  // App-specific
      continue;
    }
    await this.discoverPagesRoutes(routeDir.path, "");  // Pages-specific
  }
}
```

**Key Differences**:
| Aspect | Pages Router | App Router |
|--------|-------------|------------|
| File naming | `about.tsx` -> `/about` | `about/page.tsx` -> `/about` |
| Index route | `index.tsx` -> `/` | `page.tsx` in root -> `/` |
| Route groups | Not supported | `(group)` directories ignored |
| Parallel routes | Not supported | `@slot` directories skipped |

---

## 4. Recommended Solution

See **[005.0 - Router Unification RFC](./005.0-router-unification-rfc.md)** for the complete solution.

### 4.1 Unified Route Model

Create a router-agnostic route model:

```typescript
interface UnifiedRoute {
  pattern: string;           // e.g., "/blog/[id]"
  filePath: string;          // e.g., "/project/app/blog/[id]/page.tsx"
  source: "app" | "pages";   // For debugging only
  isDynamic: boolean;
  layouts: string[];         // Pre-resolved layout chain
}
```

### 4.2 Single Discovery Function

```typescript
async function discoverAllRoutes(
  projectDir: string,
  adapter: RuntimeAdapter,
  config: VeryfrontConfig,
): Promise<RouteRegistry> {
  const routes: UnifiedRoute[] = [];

  // Discover from both directories
  if (await directoryExists(appDir, adapter)) {
    routes.push(...await discoverAppRoutes(appDir, adapter));
  }
  if (await directoryExists(pagesDir, adapter)) {
    routes.push(...await discoverPagesRoutes(pagesDir, adapter));
  }

  // Deduplicate (app/ takes priority)
  return { routes: deduplicateRoutes(routes), projectDir };
}
```

### 4.3 Migration Path

1. **Phase 1**: Create `UnifiedRoute` model and adapters
2. **Phase 2**: Add unified discovery alongside existing code
3. **Phase 3**: Route resolution through unified model
4. **Phase 4**: Fix `getAllPages()` to use unified discovery
5. **Phase 5**: Remove router-specific code paths
6. **Phase 6**: Remove `detectAppRouter()` from business logic

---

## 5. Files to Modify

| File | Changes |
|------|---------|
| `src/rendering/router-detection.ts` | Keep for backwards compat, mark deprecated |
| `src/rendering/page-resolution/page-resolver.ts` | Use unified discovery, fix getAllPages() |
| `src/rendering/app-route-resolver.ts` | Merge into unified resolver |
| `src/types/entities/getEntityInfo.ts` | Simplify, remove pages-specific logic |
| `src/routing/slug-mapper/path-candidate-generator.ts` | Consolidate into single generator |
| `src/rendering/route-params-extractor.ts` | Merge App/Pages extractors |
| `src/rendering/layouts/layout-collector.ts` | Remove router branching |
| `src/rendering/layouts/layout-applicator.ts` | Unify wrapping logic |
| `src/server/dev-server/route-discovery.ts` | Use unified discovery |
| `src/server/build-routes.ts` | Use unified discovery |

---

## 6. Success Criteria

After refactoring, the codebase should have:

1. **Single Route Discovery Function**: One function that handles both `app/` and `pages/` directories
2. **Unified Entity Resolution**: One code path that resolves pages regardless of router type
3. **Router-Agnostic Layout Collection**: Layout discovery that works the same for both routers
4. **Fixed getAllPages()**: Method that correctly discovers all routes for SSG
5. **Single Params Extractor**: One function for route parameter extraction
6. **Consistent Dynamic Route Handling**: Same behavior for `[id]` in both routers

**Metrics**:
| Metric | Target |
|--------|--------|
| `detectAppRouter()` calls in business logic | **0** |
| Duplicate route functions | **0** |
| SSG App Router page coverage | **100%** |
| Lines of routing code | **-400** |

---

## 7. Testing Strategy

1. **Create router-agnostic test fixtures** with both `app/` and `pages/` directories
2. **Test route precedence** when same pattern exists in both routers
3. **Test mixed projects** with some routes in app/ and some in pages/
4. **Test SSG with App Router** to verify getAllPages() fix
5. **Test dynamic routes** work identically in both routers
6. **Test layout resolution** produces same results regardless of router

---

## 8. References

- Next.js App Router: https://nextjs.org/docs/app
- Next.js Pages Router: https://nextjs.org/docs/pages
- Router Detection Tests: `tests/integration/routing/router-detection.test.ts`
- Parent RFC: Chapter 001 (Adapter Interface Unification)
