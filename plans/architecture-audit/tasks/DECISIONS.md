# Architectural Decisions Required

Before implementation, these decisions need sign-off.

## Decision Status

| Status | Meaning |
|--------|---------|
| **OPEN** | Needs discussion |
| **PROPOSED** | Has recommendation, needs approval |
| **DECIDED** | Approved, ready to implement |

---

## D001: Config File Format

**Status: PROPOSED**
**Blocks: Task 001**

### Question
Should we migrate from `.ts` config to `.json` config?

### Options
| Option | Pros | Cons |
|--------|------|------|
| **A: JSON only** | Zero code execution risk, fast, simple | No computed values, breaking change |
| **B: JSON + env vars** | Low risk, supports secrets | Limited flexibility |
| **C: TS in sandbox** | Full flexibility, backward compat | Complex, escape risk |

### Recommendation
**Option B: JSON with env var interpolation** for production.
```json
{ "api": { "baseUrl": "${API_URL}" } }
```
Keep TS sandbox for local dev only.

### Decision
- [ ] Approved
- [ ] Rejected (reason: _________)

---

## D002: AsyncLocalStorage Scope

**Status: PROPOSED**
**Blocks: Tasks 002-005, 007, 009, 029**

### Question
What should be in RequestContext vs passed explicitly?

### Options
| In Context | Passed Explicitly |
|------------|-------------------|
| projectId, slug, env | adapter instance |
| headCollector | config object |
| ssrContext | page path |
| runtimeConfig | |

### Recommendation
Include frequently-accessed, request-scoped state in context. Pass large objects explicitly.

### Decision
- [ ] Approved
- [ ] Modified (changes: _________)

---

## D003: Caching Strategy

**Status: PROPOSED**
**Blocks: Tasks 011, 026, 027**

### Question
Which caches should be content-addressed (shared) vs identity-based (isolated)?

### Recommendation

| Cache | Strategy | Reason |
|-------|----------|--------|
| Transform | Content-addressed | Same code = same output |
| HTTP Module | Content-addressed | URL is the identity |
| MDX Compile | Content-addressed | Same source = same bundle |
| Render | Identity (projectId) | Output includes project data |
| Data Fetch | Identity (projectId) | Uses project's API token |
| Layout | Identity (projectId) | Depends on project structure |

### Decision
- [ ] Approved
- [ ] Modified (changes: _________)

---

## D004: Cache Key Format

**Status: PROPOSED**
**Blocks: Task 027**

### Question
What format should all cache keys use?

### Recommendation
```
v{version}:{type}:{scope?}:{identifier}:{hash}
```

Examples:
- `v18:transform:pages/index.tsx:abc123:browser`
- `v18:render:proj-123:/about:def456`

### Decision
- [ ] Approved
- [ ] Modified (format: _________)

---

## D005: Semaphore Limits

**Status: OPEN**
**Blocks: Task 006**

### Question
What should per-project and global limits be?

### Options to Decide
| Semaphore | Current Global | Proposed Per-Project | Proposed Global |
|-----------|----------------|---------------------|-----------------|
| Render | 30 | ? | ? |
| Transform | 20 | ? | ? |
| API | 50 | ? | ? |

### Considerations
- Too low per-project = slow single-project dev
- Too high per-project = one project can dominate
- Need headroom for burst traffic

### Decision
- [ ] Limits decided: render=___/___  transform=___/___  api=___/___

---

## D006: Timeout Hierarchy

**Status: PROPOSED**
**Blocks: Task 023**

### Question
What should the timeout hierarchy be?

### Recommendation
| Level | Timeout | Margin |
|-------|---------|--------|
| Request | 60s | - |
| Render Pipeline | 45s | 15s margin |
| Stage (layout, data, SSR) | 30s | 15s margin |
| IO (fetch, file read) | 15s | 15s margin |

### Decision
- [ ] Approved
- [ ] Modified (values: _________)

---

## D007: Error Response Format

**Status: OPEN**
**Blocks: Task 024**

### Question
What should 500 error responses look like?

### Options
| Option | Production | Development |
|--------|------------|-------------|
| **A: HTML page** | Branded error page | Full stack trace |
| **B: JSON** | `{ error: "code" }` | `{ error, stack, context }` |
| **C: Hybrid** | HTML for browsers, JSON for API | Same |

### Decision
- [ ] Option chosen: ___
- [ ] Error codes defined: ___

---

## D008: Adapter Interface Methods

**Status: PROPOSED**
**Blocks: Task 016**

### Question
What methods should the unified adapter interface have?

### Recommendation
```typescript
interface UnifiedFSAdapter {
  // Core (required)
  readFile(path: string): Promise<string>;
  readFileBinary(path: string): Promise<Uint8Array>;
  fileExists(path: string): Promise<boolean>;
  walkDirectory(root: string, filter?): AsyncIterable<string>;

  // Metadata (optional)
  getProjectMetadata?(): { updatedAt?: string; id?: string };
}
```

### Decision
- [ ] Approved
- [ ] Methods added: _______
- [ ] Methods removed: _______

---

## D009: React Version Strategy

**Status: DECIDED**
**Blocks: Task 008**

### Question
How do we handle different React versions across projects?

### Options
| Option | Pros | Cons |
|--------|------|------|
| **A: Version from package.json** | Explicit | Requires parsing |
| **B: Version from import map** | Already have | May not specify version |
| **C: Detect from esm.sh URL** | Automatic | Fragile |
| **D: Version from veryfront.config** | Explicit, single source of truth | New config field |

### Decision
- [x] **Option D: `veryfront.config.react.version`**

```typescript
// veryfront.config.ts
export default {
  react: {
    version: "18.3.1"
  }
}
```

---

## D010: Test Utility API

**Status: OPEN**
**Blocks: Task 032**

### Question
What should the multi-tenant test API look like?

### Proposed API
```typescript
// Option A: Concurrent wrapper
await withConcurrentTenants({
  projectA: () => render("/page"),
  projectB: () => render("/page"),
});

// Option B: Isolation assertion
await verifyConcurrentIsolation(
  (projectId) => renderWithContext(projectId, "/page"),
  ["project-a", "project-b"]
);
```

### Decision
- [ ] API approved
- [ ] API modified: _______

---

## D011: Path Validation Strategy

**Status: OPEN**
**Blocks: Task 043**

### Question
How should path traversal validation be implemented?

### Options
| Option | Pros | Cons |
|--------|------|------|
| **A: Centralized utility** | Single implementation, consistent | All adapters must call it |
| **B: Per-adapter** | Adapter-specific handling | Duplication, inconsistency risk |
| **C: Middleware** | Automatic for all requests | May miss internal calls |

### Decision
- [ ] Option chosen: ___
- [ ] Implementation details: ___

---

## D012: Cache Eviction Strategy

**Status: OPEN**
**Blocks: Tasks 053, 054**

### Question
What eviction strategy should caches use?

### Options
| Option | Pros | Cons |
|--------|------|------|
| **A: LRU (Least Recently Used)** | Good hit rate, simple | Size-blind |
| **B: TTL (Time-Based)** | Freshness guarantee | Poor hit rate for hot items |
| **C: LRU + TTL hybrid** | Best of both | More complex |
| **D: Size-based (memory budget)** | Memory predictable | May evict hot items |

### Recommendation
**Option C: LRU + TTL hybrid** - Use LRU for eviction order, TTL for staleness.

### Decision
- [ ] Strategy chosen: ___
- [ ] TTL values: ___
- [ ] LRU limits: ___

---

## D013: Cache Size Limits

**Status: OPEN**
**Blocks: Tasks 053, 054**

### Question
How should cache size limits be configured?

### Options
| Option | Description |
|--------|-------------|
| **A: Per-cache limits** | Each cache has own max entries/size |
| **B: Global memory budget** | All caches share total memory limit |
| **C: Both** | Per-cache minimums + global ceiling |

### Proposed Limits (Option A)
| Cache | Max Entries | Max Size |
|-------|-------------|----------|
| Module | 5,000 | 500MB |
| Transform | 10,000 | 1GB |
| Render | 1,000 | 200MB |

### Decision
- [ ] Approach chosen: ___
- [ ] Limits defined: ___

---

## D014: Naming Convention Standard

**Status: OPEN**
**Blocks: Task 057**

### Question
What naming conventions should the codebase follow?

### Categories to Decide
| Category | Proposed Standard |
|----------|-------------------|
| Handler vs Middleware | `middleware` for processing, `handler` for terminal |
| ctx vs context | `ctx` for params, full name for types |
| Project identifiers | Always `projectId` or `projectSlug` |
| Booleans | `is`, `has`, `should`, `can` prefix |
| Async functions | No `Async` suffix |

### Decision
- [ ] Standards approved
- [ ] Modifications: ___

---

## D015: Large File Decomposition Strategy

**Status: OPEN**
**Blocks: Task 056**

### Question
How should large files (>1000 LOC) be decomposed?

### Options
| Option | Pros | Cons |
|--------|------|------|
| **A: Big bang** | Consistent structure | High risk, many conflicts |
| **B: Incremental (one per sprint)** | Manageable changes | Takes longer |
| **C: Opportunistic** | Low overhead | May never complete |
| **D: Leave as-is** | No disruption | Tech debt remains |

### Recommendation
**Option B: Incremental** - One file per sprint, starting with lowest-coupling.

### Decision
- [ ] Approach chosen: ___
- [ ] Priority order: ___

---

## How to Decide

1. **Review** the options above
2. **Comment** with questions or concerns
3. **Approve** by checking the box
4. **Document** any modifications

Once decided, the task can proceed to implementation.
