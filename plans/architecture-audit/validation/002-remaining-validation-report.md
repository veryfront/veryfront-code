# Chapter 002 Validation Report - Issues 002.4-002.9

> Generated: 2026-01-28 | Reviewers: Multi-AI Code Review Agents

## Executive Summary

Validated 6 remaining issues from Chapter 002 (Global State). Results:

| Outcome | Count | Issues |
|---------|-------|--------|
| **Confirmed (needs fix)** | 2 | 002.4 (partial), 002.5 |
| **False Positive** | 3 | 002.6, 002.7, 002.9 |
| **Downgraded** | 1 | 002.8 (MEDIUM→MEDIUM, but narrower scope) |

---

## Issue 002.4: Semaphore Starvation

### Original Claim
Four global semaphores shared across all projects allow "noisy neighbor" to starve other projects.

### Validation Result: **PARTIALLY VALID (MEDIUM)**

#### Findings

| Semaphore | Location | Status |
|-----------|----------|--------|
| `renderSemaphore` | renderer.ts:121 | **FIXED** - Has per-project limits (commit 43cfc64a) |
| `transformSemaphore` | memory.ts:43 | **NEEDS FIX** - Global, no per-project isolation |
| `apiSemaphore` | parallel.ts:16 | **NEEDS FIX** - Global, 20 permits shared |
| `revalidationSemaphore` | static-data-fetcher.ts:17 | **LOW RISK** - Graceful degradation, background task |

#### Evidence

**renderSemaphore fix (renderer.ts:106-146):**
```typescript
const RENDER_PER_PROJECT_LIMIT = parseInt(
  getEnv("RENDER_PER_PROJECT_LIMIT") ?? String(Math.ceil(RENDER_MAX_CONCURRENT / 3)),
  10,
);

const projectRenderCounts = new Map<string, number>();

function acquireProjectSlot(projectId: string): boolean {
  if (RENDER_PER_PROJECT_LIMIT <= 0) return true;
  const current = projectRenderCounts.get(projectId) ?? 0;
  if (current >= RENDER_PER_PROJECT_LIMIT) return false;
  projectRenderCounts.set(projectId, current + 1);
  return true;
}
```

**transformSemaphore (still global):**
```typescript
export const transformSemaphore = new Semaphore(MAX_CONCURRENT_TRANSFORMS);
// No per-project protection
```

### Recommendation

Apply the same `projectRenderCounts` pattern to `transformSemaphore`. Create `FairSemaphore` utility as described in the audit document.

**Priority: HIGH** (transformSemaphore)
**Priority: MEDIUM** (apiSemaphore)

---

## Issue 002.5: AI Registry Leakage

### Original Claim
Six AI registries use globalThis singleton pattern without project scoping, enabling cross-project tool/agent/workflow access.

### Validation Result: **CONFIRMED CRITICAL**

#### Findings

All 6 registries confirmed using global singleton pattern:

| Registry | File | Line | Pattern |
|----------|------|------|---------|
| `toolRegistry` | tool/registry.ts | 41-50 | `globalThis[KEY] ??= new ToolRegistryClass()` |
| `promptRegistry` | prompt/registry.ts | 55-66 | Same pattern |
| `workflowRegistry` | workflow/registry.ts | 314-320 | Same pattern |
| `agentRegistry` | agent/composition/composition.ts | 150-159 | Same pattern |
| `resourceRegistry` | resource/registry.ts | 55-64 | Same pattern |
| `providerRegistry` | provider/factory.ts | 165-170 | Same pattern |

#### Security Impact

1. **Tool Discovery**: Project B can enumerate Project A's tools via `toolRegistry.getAllIds()`
2. **Tool Execution**: Project B can execute Project A's tools via `executeTool()`
3. **Agent Access**: Project B can use Project A's agents (including system prompts/credentials)
4. **Workflow Execution**: Cross-project workflow execution possible
5. **Provider Leakage**: API keys configured in one project accessible by others

#### Evidence

```typescript
// tool/registry.ts lines 41-50
const TOOL_REGISTRY_KEY = "__veryfront_tool_registry__";
const globalRegistry = globalThis as GlobalToolRegistry;
export const toolRegistry: ToolRegistryClass = globalRegistry[TOOL_REGISTRY_KEY] ??=
  new ToolRegistryClass();
```

The registry uses `Map<string, Tool>` with tool ID as key - **no projectId scoping**.

### Recommendation

Implement `ProjectScopedRegistryManager` as described in audit document. Use composite keys: `${projectId}:${resourceId}`.

**Priority: P0 (CRITICAL)** - Security vulnerability

---

## Issue 002.6: In-Progress Deadlock

### Original Claim
`globalInProgress` map tracks transforms without project scoping or timeout, causing indefinite hangs.

### Validation Result: **FALSE POSITIVE**

#### Findings

1. **Keys DO include projectId** via `buildSSRModuleCacheKey()`:
```typescript
// Key format: v{version}:{projectId}:{contentSourceId}:{reactVersion}:{filePath}:{contentHash}
return `${CacheKeyPrefix.SSR_VERSION}${version}:${projectId}:${filePath}`;
```

2. **Timeout mechanism EXISTS** (30 seconds):
```typescript
// loader.ts lines 571-592
await withTimeoutThrow(
  existingTransform,
  IN_PROGRESS_WAIT_TIMEOUT_MS,  // 30,000ms
  `Waiting for in-progress transform of ${filePath}`,
);
```

3. **Cleanup on timeout**:
```typescript
} catch (error) {
  globalInProgress.delete(inProgressKey);  // Remove stale entry
}
```

### Conclusion

Cross-project collision is impossible due to projectId in keys. Hanging transforms timeout after 30 seconds with cleanup.

---

## Issue 002.7: Failed Components Collision

### Original Claim
`failedComponents` map keys lack projectId, causing errors from one project to block other projects' valid components.

### Validation Result: **FALSE POSITIVE**

#### Findings

Keys DO include projectId via `getCacheKey()`:
```typescript
// loader.ts lines 259-272
private getCacheKey(filePath: string): string {
  return buildSSRModuleCacheKey(
    TRANSFORM_CACHE_VERSION,
    this.options.projectId,  // <-- projectId included
    `${this.options.contentSourceId}:${reactVersion}:${filePath}`,
  );
}
```

**Example keys:**
- Project A: `v42:proj-A:release-1:19:pages/index.tsx`
- Project B: `v42:proj-B:release-2:19:pages/index.tsx`

These are distinct - no collision possible.

### Conclusion

The `failedComponents` map correctly includes projectId in all cache keys. No fix needed.

---

## Issue 002.8: Tailwind Compiler State

### Original Claim
Global Tailwind compiler state causes conflicts when projects have different configurations.

### Validation Result: **MEDIUM (narrower scope)**

#### Findings

1. **Compiler IS keyed by stylesheet hash** - different configurations DO get different compilers
2. **However, race condition exists** - single `compiler`/`lastStylesheetHash` globals mean concurrent requests could get wrong compiler
3. **Plugin cache IS problematic** - `pluginCache` is global, different versions could collide

#### Evidence

```typescript
// Lines 30-35
let compiler: Awaited<ReturnType<typeof compile>> | null = null;
let lastStylesheetHash = "";
const pluginCache = new Map<string, unknown>();  // Global, unscoped
```

### Recommendation

1. Use LRU cache keyed by stylesheet hash instead of single globals
2. Scope plugin cache by stylesheet hash: `pluginCache.set(\`${stylesheetHash}:${id}\`, plugin)`

**Priority: MEDIUM** - Race condition under concurrent load

---

## Issue 002.9: Tailwind Cache Environment Scope

### Original Claim
CSS cache key doesn't include environment, causing preview CSS to leak to production.

### Validation Result: **LOW / FALSE POSITIVE**

#### Findings

1. **Preview and production use DIFFERENT code paths**:
   - Production: Calls `getProjectCSS()` to inline CSS
   - Preview: Uses link tag to `StylesCSSHandler` for dynamic generation

2. **Cache is content-addressed** - `candidatesHash` validation ensures CSS matches actual classes used

3. **Same inputs = same CSS is CORRECT behavior** - CSS generation is deterministic

#### Evidence

```typescript
// html-shell-generator.ts lines 129-147
const useProductionCSS = !localDev && options.environment === "production";
if (useProductionCSS && projectSlug !== "default") {
  // Only production calls getProjectCSS
}
```

### Conclusion

The separation of code paths between preview and production prevents cross-environment contamination. No fix needed.

---

## Summary of Required Fixes

| Issue | Priority | Work Estimate | Blocks |
|-------|----------|---------------|--------|
| **002.5** AI Registry Leakage | P0 | 2-3 days | Security critical |
| **002.4** Transform Semaphore | HIGH | 1 day | Production stability |
| **002.8** Tailwind Plugin Cache | MEDIUM | 0.5 day | Edge case under load |

## Recommended Implementation Order

1. **002.5** - Security fix for AI registries (CRITICAL)
2. **002.4** - FairSemaphore for transforms (HIGH)
3. **002.8** - Tailwind plugin cache scoping (MEDIUM)
