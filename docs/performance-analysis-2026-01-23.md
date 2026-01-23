# Performance Analysis: Cold Start Trace 73d62bea96133a7d02bd83cef6cd8ac4

**Date:** 2026-01-23
**Total Duration:** 11.7s (cold start)
**Project:** codersociety

## Executive Summary

Analysis of a cold start trace revealed **6 performance issues** with potential savings of **~2.4s** (20% improvement).

**Status: 4 of 4 prioritized fixes implemented** ✅

## Trace Waterfall

```
0         1000      2000      3000      4000      5000      6000      7000      8000      9000      10000     11000
|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|----|

[0-166]     ████ api.request /projects/codersociety (156ms)
[167-312]   ████ api.request /projects/{uuid} (145ms)  ✅ FIXED
[314-550]   █████ api.request /files page 1 (236ms)
[556-795]   █████ api.request /files page 2 (239ms)
[795-1138]  ░░░░░░ GAP (343ms) - untraced
[1292-1460] ███ config.load (168ms)
[1515-1994] ██████████ render.resolve_page (479ms)
  [1573-1836]  ██████ api.request /files?pattern=.* (263ms) ✅ FIXED
[1995-2329] ███████ layout.collect (334ms)
  [2163-2319] ████ mdx.compile (156ms)
  [2320-2329] █ mdx.compile (9ms) - minor
[2329-6131] ████████████████████████ render.prepare_bundles - PAGE (3802ms)
[6132-8603] ████████████████ render.apply_layouts - LAYOUT (2471ms) ✅ NOW PARALLEL
[8603-11744] █████████████████████████ render.ssr (3141ms)
```

## Fixes Implemented

### ✅ Fix 1: Duplicate Project Fetch (~145ms saved)

**Commit:** `054c337c` - perf: reduce cold start time by ~2.4s with 3 optimizations

**Changes:**
- `src/platform/adapters/veryfront-api-client/client.ts:194` - Added `cachedProjectData` field, store project during `doInitialize()`
- `src/platform/adapters/fs/veryfront/adapter.ts:213-230` - Use `getCachedProject()` instead of re-fetching

**Before:**
```typescript
// client.ts - FIRST fetch (by slug)
const project = await this.operations.getProject(slug);
this.operations.setProjectId(project.id);  // Only saves ID, discards project data!

// adapter.ts - SECOND fetch (by ID)
this.projectData = await this.client.getProject(projectId);  // Fetches same project again!
```

**After:**
```typescript
// client.ts - Store project data during init
this.cachedProjectData = project;

// adapter.ts - Use cached data
const cachedProject = this.client.getCachedProject();
if (cachedProject) {
  this.projectData = cachedProject;  // No API call!
}
```

---

### ✅ Fix 2: Unnecessary Pattern Search (~263ms saved)

**Commit:** `054c337c`

**Changes:**
- `src/platform/adapters/fs/veryfront/stat-operations.ts:430-442` - Skip API search when file list is complete

**Before:**
```typescript
// Always does API pattern search as fallback
const matches = await this.apiClient.searchFiles(/* ... */);
```

**After:**
```typescript
// Skip API search if we have the complete file list from initialization
if (this.contextProvider?.getFileList) {
  logger.debug("[StatOperations] resolveFile not found (complete index, skipping API search)");
  return null;  // No API call!
}
```

---

### ✅ Fix 3: Sequential Page + Layout Loading (~2000ms saved)

**Commit:** `054c337c`

**Changes:**
- `src/rendering/orchestrator/layout.ts:47-97` - Added `preloadLayoutModules()` method
- `src/rendering/orchestrator/pipeline.ts:295-302,489` - Start preload after collectLayouts, runs parallel with preparePageBundles

**Before:**
```
Stage 4 (page bundle):    [2329ms -------- 6131ms] (3802ms)
Stage 5 (layout apply):                           [6132ms ---- 8316ms] (2184ms) ← WAITS!
```

**After:**
```
Stage 2 (collect layouts): [1995ms -- 2329ms]
Layout preload:                      [2329ms -------> runs in background]
Stage 4 (page bundle):               [2329ms -------- 6131ms] (3802ms)
Stage 5 (layout apply):                              [6131ms --] ← INSTANT (from cache)
```

---

### ✅ Fix 4: Context Enrichment (architectural improvement)

**Commit:** `e6511a82` - perf: implement EnrichedContext for unified request data

**Changes:**
- `src/server/context/enriched-context.ts` - New EnrichedContext type and factory
- `src/types/server.ts` - Added `enriched` field to HandlerContext
- `src/rendering/context/render-context.ts` - Added `createRenderContextFromEnriched()` fast path
- `src/rendering/renderer.ts` - Re-export new function
- `src/server/universal-handler/index.ts` - Build EnrichedContext at request entry
- `src/server/shared/renderer/adapter.ts` - Use EnrichedContext when available

**Before:**
- 4 separate context objects (RequestContext, HandlerContext, RenderContext, per-request services)
- Redundant computation of cachePrefix, projectId, environment
- Config may be loaded multiple times

**After:**
```typescript
interface EnrichedContext {
  // Core identification
  projectId: string;
  projectSlug: string;
  projectDir: string;

  // Request data
  token: string;
  environment: "preview" | "production";
  branch: string | null;
  isLocalDev: boolean;
  mode: "development" | "production";

  // Pre-computed
  config: VeryfrontConfig;  // Loaded once
  cachePrefix: string;      // Computed once
  adapter: RuntimeAdapter;

  // Timing
  createdAt: number;
}
```

---

## Remaining Issues (Lower Priority)

### Issue 3: Duplicate MDX Compile (~9ms)

**Location:** `src/rendering/layouts/layout-collector.ts`

Same layout file compiled twice with different content lengths. Minor impact (~9ms).

### Issue 5: Unexplained Gap (343ms)

**Location:** Between file list completion (795ms) and config.load (1138ms)

Investigation needed to determine what happens during this gap.

---

## Results Summary

| Fix | Issue | Savings | Status |
|-----|-------|---------|--------|
| 1 | Duplicate project fetch | ~145ms | ✅ Implemented |
| 2 | Pattern search elimination | ~263ms | ✅ Implemented |
| 3 | Parallel page+layout loading | ~2000ms | ✅ Implemented |
| 4 | Context enrichment | ~50-100ms | ✅ Implemented |
| **Total** | | **~2.4s** | |

**Estimated new cold start time: ~9.3s** (20% improvement)

---

## Commits

1. `054c337c` - perf: reduce cold start time by ~2.4s with 3 optimizations
   - Fix 1: Cache project data
   - Fix 2: Skip pattern search
   - Fix 3: Parallel layout preloading

2. `e6511a82` - perf: implement EnrichedContext for unified request data
   - Fix 4: Context enrichment architecture

3. `8adc29f7` - fix: improve proxy-mode context enrichment and validation
   - Add validation to fast path in createRenderContextFromEnriched()
   - Attach enriched back to ctx in proxy mode slow path

4. `0930bed5` - fix: pass resolvedEnvironment through HandlerContext for proxy mode
   - Add resolvedEnvironment field to HandlerContext
   - Ensure domain lookup environment reaches adapter slow path

5. `9469d247` - fix: use resolvedEnvironment consistently for cache and HTTP headers
   - Update extractCacheKeyContext to prefer resolvedEnvironment
   - Add shouldUseNoCacheHeadersFromHandler helper for handlers
   - Update SSR/module handlers to use resolvedEnvironment for cache decisions
