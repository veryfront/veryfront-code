# Cross-Project Cache Pollution: Concrete Example

This document shows a specific scenario where Project A's cached content can be served to Project B.

---

## The Global State (src/modules/react-loader/ssr-module-loader/cache/memory.ts)

```typescript
// Line 41 - GLOBAL across all projects
export const failedComponents = new Map<string, FailureRecord>();

// Line 43 - GLOBAL semaphore shared by all projects
export const transformSemaphore = new Semaphore(MAX_CONCURRENT_TRANSFORMS);

// Line 35 - GLOBAL in-progress tracking
export const globalInProgress = new Map<string, Promise<void>>();
```

---

## Scenario 1: Failed Component Leakage

### Timeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│ t0: Project A - Button.tsx has syntax error                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   Request: GET https://projectA.veryfront.com/page                      │
│                                                                          │
│   SSRModuleLoader.loadComponent("components/Button.tsx")                │
│       │                                                                  │
│       ▼                                                                  │
│   circuitKey = getCacheKey("components/Button.tsx")                     │
│   = "ssr:v42:projA-uuid:draft:19.1.0:components/Button.tsx"             │
│       │                                                                  │
│       ▼                                                                  │
│   Transform fails (syntax error)                                        │
│       │                                                                  │
│       ▼                                                                  │
│   failedComponents.set(circuitKey, { count: 1, lastFailure: Date.now() })│
│                                                                          │
│   Result: 500 error returned to user                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

                              ✓ ISOLATED (projectId in key)

BUT WAIT - what if projectId is missing or wrong?
```

### When Isolation FAILS

```typescript
// loader.ts line 259-271
private getCacheKey(filePath: string): string {
  if (!this.options.contentSourceId) {
    throw new Error(...);  // ← But what if this doesn't throw?
  }
  return buildSSRModuleCacheKey(
    TRANSFORM_CACHE_VERSION,
    this.options.projectId,    // ← What if this is undefined/empty?
    `${this.options.contentSourceId}:${reactVersion}:${filePath}`,
  );
}
```

If `projectId` is ever undefined, empty, or a default value:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ POLLUTION SCENARIO: projectId = "" (empty string)                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Project A: components/Button.tsx fails                                 │
│  circuitKey = "ssr:v42::draft:19.1.0:components/Button.tsx"             │
│                     ↑                                                    │
│                  empty!                                                  │
│                                                                          │
│  failedComponents.set(key, { count: 3, lastFailure: now })              │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  Project B: components/Button.tsx (valid code!)                         │
│  circuitKey = "ssr:v42::draft:19.1.0:components/Button.tsx"             │
│                     ↑                                                    │
│               SAME KEY!                                                  │
│                                                                          │
│  checkCircuitBreaker(circuitKey):                                       │
│    failedComponents.get(key) → { count: 3, ... }                        │
│    count >= 3 → THROW "temporarily blocked"                             │
│                                                                          │
│  Result: Project B's VALID Button.tsx is blocked!                       │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Scenario 2: Transform Cache Pollution (No projectId!)

The `buildTransformCacheKey` function does NOT include projectId:

```typescript
// cache/keys.ts line 260-268
export function buildTransformCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
  studioEmbed: boolean = false,
): string {
  const ssrKey = ssr ? "ssr" : "browser";
  const studioKey = studioEmbed ? ":studio" : "";
  return `v${TRANSFORM_CACHE_VERSION}:${filePath}:${contentHash}:${ssrKey}${studioKey}`;
  //                              ↑
  //                     NO PROJECT ID!
}
```

### When This Causes Problems

```
┌─────────────────────────────────────────────────────────────────────────┐
│ POLLUTION SCENARIO: Different projects, same relative path              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Project A: /projects/alpha/components/Button.tsx                       │
│    content: "export function Button() { return <button>A</button> }"    │
│    contentHash: "abc123"                                                │
│                                                                          │
│  Transform Pipeline:                                                    │
│    cacheKey = "v42:/projects/alpha/components/Button.tsx:abc123:browser"│
│    transformedCode = "...bundled code with Project A's logic..."        │
│    cache.set(cacheKey, transformedCode)                                 │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  Project B: /projects/beta/components/Button.tsx                        │
│    content: "export function Button() { return <button>B</button> }"    │
│    contentHash: "abc123"  ← SAME HASH (coincidence or collision)        │
│                                                                          │
│  Transform Pipeline:                                                    │
│    cacheKey = "v42:/projects/beta/components/Button.tsx:abc123:browser" │
│                              ↑                                           │
│                     Different path = different key                      │
│                                                                          │
│  ✓ In this case, ISOLATION WORKS because paths differ                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

BUT if filePath is normalized to a relative path:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ POLLUTION SCENARIO: Relative paths used                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Project A: components/Button.tsx                                       │
│    content: "export function Button() { return <button>A</button> }"    │
│    contentHash: "abc123"                                                │
│                                                                          │
│  Transform Pipeline:                                                    │
│    cacheKey = "v42:components/Button.tsx:abc123:browser"                │
│    cache.set(cacheKey, transformedCode_A)                               │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  Project B: components/Button.tsx (SAME relative path)                  │
│    content: "export function Button() { return <button>A</button> }"    │
│    contentHash: "abc123"  ← SAME because content is the same            │
│                                                                          │
│  Transform Pipeline:                                                    │
│    cacheKey = "v42:components/Button.tsx:abc123:browser"                │
│                                 ↑                                        │
│                            SAME KEY!                                     │
│                                                                          │
│    cache.get(cacheKey) → returns Project A's transformedCode            │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  IS THIS BAD?                                                           │
│                                                                          │
│  For content-addressed cache: ✓ PROBABLY OK                             │
│    Same content → same transform → sharing is correct                   │
│                                                                          │
│  UNLESS transform depends on:                                           │
│    - Project-specific config (tailwind theme, import maps)              │
│    - Project-specific dependencies (different React versions)           │
│    - Project-specific environment variables                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Scenario 3: Semaphore Starvation (BLAST RADIUS)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ BLAST RADIUS: One project exhausts global semaphore                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Global State:                                                          │
│    transformSemaphore = Semaphore(10)  // 10 concurrent transforms max  │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  t0: Project A - complex page with 50 MDX imports                       │
│      └─ Acquires 10 semaphore slots (max)                               │
│      └─ Each transform takes 2 seconds                                  │
│                                                                          │
│  t0+100ms: Project B - simple page with 1 import                        │
│      └─ transformSemaphore.acquire() → BLOCKS                           │
│      └─ Waiting for Project A...                                        │
│                                                                          │
│  t0+200ms: Project C - simple page with 1 import                        │
│      └─ transformSemaphore.acquire() → BLOCKS                           │
│      └─ Waiting for Project A...                                        │
│                                                                          │
│  t0+2000ms: Project A finishes first batch                              │
│      └─ Releases 10 slots                                               │
│      └─ Immediately acquires 10 more for next batch                     │
│                                                                          │
│  t0+2100ms: Project B still waiting...                                  │
│  t0+2200ms: Project C still waiting...                                  │
│                                                                          │
│  Result: Projects B and C experience 10x latency because of A           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

VISUAL:

 Semaphore slots: [A][A][A][A][A][A][A][A][A][A]
                   ↑                            ↑
                 All 10 slots taken by Project A

 Waiting queue:   [B] [C] [D] [E] [F] ...
                   ↑
              Other projects blocked
```

---

## Scenario 4: In-Progress Transform Deadlock

```
┌─────────────────────────────────────────────────────────────────────────┐
│ DEADLOCK: Hanging transform blocks all projects                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Global State:                                                          │
│    globalInProgress = Map<key, Promise>                                 │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  t0: Project A imports npm package that hangs during transform          │
│                                                                          │
│    const inProgressKey = "lodash@4.17.21";                              │
│    const promise = transformModule(...);  // Never resolves!            │
│    globalInProgress.set(inProgressKey, promise);                        │
│                                                                          │
│  t1: Project B also imports lodash@4.17.21                              │
│                                                                          │
│    const existing = globalInProgress.get("lodash@4.17.21");             │
│    if (existing) {                                                      │
│      await existing;  // ← HANGS FOREVER waiting for A's promise        │
│    }                                                                     │
│                                                                          │
│  t2: Project C also imports lodash@4.17.21                              │
│    await globalInProgress.get("lodash@4.17.21");  // ← ALSO HANGS       │
│                                                                          │
│  Result: All projects using lodash are blocked indefinitely             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Summary: Cross-Project Pollution Points

| Global State | File:Line | Risk | Fix |
|-------------|-----------|------|-----|
| `failedComponents` | memory.ts:41 | Error state leakage | Include projectId in keys |
| `transformSemaphore` | memory.ts:43 | One project blocks all | Per-project semaphores |
| `globalInProgress` | memory.ts:35 | Deadlock risk | Add timeout, per-project |
| `globalCrossProjectCache` | memory.ts:31 | Content corruption spreads | Validate before caching |
| Transform cache keys | keys.ts:260 | No projectId | Add projectId to key |

---

## The Fix: Project-Scoped Keys

```typescript
// BEFORE (broken)
export function buildTransformCacheKey(
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
): string {
  return `v${VERSION}:${filePath}:${contentHash}:${ssr}`;
}

// AFTER (fixed)
export function buildTransformCacheKey(
  projectId: string,     // ← NEW: required
  filePath: string,
  contentHash: string,
  ssr: boolean = false,
): string {
  return `v${VERSION}:${projectId}:${filePath}:${contentHash}:${ssr}`;
}
```

For semaphores, use fair per-project scheduling:

```typescript
class FairProjectSemaphore {
  private globalLimit = 10;
  private perProjectLimit = 3;  // Each project gets max 3 slots
  private projectSemaphores = new Map<string, Semaphore>();

  async acquire(projectId: string): Promise<void> {
    const projectSem = this.getOrCreate(projectId, this.perProjectLimit);
    await projectSem.acquire();
  }
}
```
