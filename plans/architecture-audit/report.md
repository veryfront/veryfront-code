# Veryfront Renderer Architecture Audit

## Executive Summary for Leadership

This audit identifies critical architectural issues causing **production instability** and **unpredictable behavior** across environments. The root cause: conditional logic based on adapter type, router type, runtime, cache state, and configuration creates a **combinatorial explosion of code paths**.

```
Adapters (3) × Routers (2) × Runtimes (3) × Cache States (2) × Config Variations = 100s of code paths
```

Each combination can exhibit different behavior, making bugs that "work locally but break in production" endemic.

---

## 🎯 MUST HAVES (Non-Negotiable Requirements)

These five requirements define the target state. **All architectural decisions must align with these.**

### 1. Zero Side Effects on Startup
**When running `deno task start`, there must be absolutely no side effects.**
- No file caching to disk
- No bundle generation
- No API fetching
- No state mutation
- Server starts clean every time

### 2. Complete Project Isolation
**No side effects between projects. One project cannot affect another.**
- No shared mutable state (semaphores, caches, error maps)
- No cross-project contamination
- One broken project CANNOT take down others
- Each project operates in complete isolation

### 3. Local Dev Mirrors Remote
**Local development in preview and production mode must mirror remote exactly.**
- Same rendering output
- Same error behavior
- Same caching behavior
- If it works locally, it works in production

### 4. Adapter Parity
**No difference between file adapters. Local vs API vs GitHub must behave identically.**
- Same layout discovery
- Same config loading
- Same middleware behavior
- Single code path for all adapters

### 5. Cache Consistency
**Same behavior when cached and uncached.**
- Cache hit produces identical result to cache miss
- No stale cache bugs
- No "clear cache to fix" workarounds
- Deterministic output regardless of cache state

---

## Current Critical Issues

### 🔴 BLAST RADIUS - One Project Takes Down Others
The most severe issue: **shared mutable state means one broken project can take down all others**.

| Global State | Risk |
|-------------|------|
| `transformSemaphore` | Exhaustion blocks ALL projects |
| `failedComponents` | Error leakage across projects |
| `globalCrossProjectCache` | Corruption affects ALL projects |
| `globalInProgress` | Hanging promises cause cross-project deadlocks |

**Impact**: A single malformed user project can cause system-wide outage.

### 🔴 Adapter Divergence
App Router nested layouts **work locally but break in production** because the API adapter uses completely different layout discovery code.

### 🔴 Silent Failures
150+ locations swallow errors without logging, making production debugging nearly impossible.

---

## Estimated Impact

| Metric | Before | After |
|--------|--------|-------|
| Lines of duplicated/conditional code | ~3,600+ | Eliminated |
| Architectural surface area | 100% | ~60% |
| Code paths to test | 100s | ~20 |
| "Works locally, breaks in production" bugs | Common | Eliminated |

---

---

## The Core Problem: Combinatorial Explosion

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMBINATORIAL EXPLOSION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ADAPTER:         Local FS  ←────→  Veryfront API  ←────→  GitHub      │
│                       │                   │                  │          │
│                       ▼                   ▼                  ▼          │
│  ROUTER:          App Router  ←────────→  Pages Router                  │
│                       │                         │                       │
│                       ▼                         ▼                       │
│  RUNTIME:         Deno  ←────→  Node  ←────→  Bun  ←────→  Cloudflare  │
│                       │            │           │                        │
│                       ▼            ▼           ▼                        │
│  CACHE:           Cache Hit  ←────────→  Cache Miss                     │
│                       │                    │                            │
│                       ▼                    ▼                            │
│  CONFIG:          layout  ×  router  ×  fs.type  ×  experimental.*     │
│                                                                         │
│  Each conditional multiplies the number of code paths to test          │
└─────────────────────────────────────────────────────────────────────────┘
```

**Every conditional creates a potential "works in X, breaks in Y" bug.**

---

## Chapters

### Core Divergence Issues

| # | Chapter | Concern | Risk | Files |
|---|---------|---------|------|-------|
| [001](./001-adapter-divergence.md) | File Adapter Divergence | Different behavior across Local/API/GitHub adapters | **CRITICAL** | ~15 |
| [002](./002-global-state.md) | Global State & Multi-Tenant | Cross-project contamination risks | **CRITICAL** | ~12 |
| [003](./003-cache-behavior.md) | Cache Hit vs Miss Behavior | Code paths differ when cached vs fresh | **HIGH** | ~20 |
| [004](./004-bundle-dependencies.md) | Bundle Dependency Tracking | Stale bundles when deps change | **HIGH** | ~8 |
| [005](./005-router-divergence.md) | App Router vs Pages Router | Parallel implementations with subtle differences | **MEDIUM** | ~10 |
| [006](./006-runtime-conditionals.md) | Runtime Conditional Branching | 84 files with Deno/Node/Bun checks | **MEDIUM** | ~84 |

### Configuration & Input Handling

| # | Chapter | Concern | Risk | Files |
|---|---------|---------|------|-------|
| [007](./007-config-normalization.md) | Config Format Normalization | Multiple formats for same option | **LOW** | ~5 |
| [008](./008-userland-config.md) | Userland Config Code Paths | User options that change execution | **HIGH** | ~30 |

### Implementation Fragmentation

| # | Chapter | Concern | Risk | Files |
|---|---------|---------|------|-------|
| [009](./009-timeout-handling.md) | Timeout Handling | 100+ hardcoded timeout values | **MEDIUM** | ~25 |
| [010](./010-error-handling.md) | Error Handling & Silent Failures | 150+ silent catch blocks | **HIGH** | ~50 |
| [011](./011-import-rewriting.md) | Import Rewriting | 7 implementations (~1,038 lines) | **MEDIUM** | 7 |
| [012](./012-http-clients.md) | HTTP Client Implementations | 12+ HTTP clients with different retry/timeout | **MEDIUM** | ~12 |

### Caching Infrastructure

| # | Chapter | Concern | Risk | Files |
|---|---------|---------|------|-------|
| [013](./013-cache-key-patterns.md) | Cache Key Patterns & Storage | 18+ cache systems, inconsistent keys | **HIGH** | ~20 |

---

## Key Findings Summary

### Critical Issues

1. **BLAST RADIUS - One Broken Project Takes Down Others**:
   - `transformSemaphore` exhaustion blocks ALL projects
   - `failedComponents` map can leak errors across projects
   - `globalCrossProjectCache` corruption affects ALL projects
   - `globalInProgress` hanging promises cause cross-project deadlocks
   - No per-project resource isolation

2. **Adapter Divergence**: App Router nested layouts work locally but break with API adapter

3. **Global State Data Leakage**: 5+ critical globals can leak data between projects (head collector, React cache, SSR globals)

4. **Cache Contamination**: Transform cache not project-scoped, environment paths leak across pods

5. **Silent Failures**: 150+ locations swallow errors without logging

### High Priority Issues

5. **No Dependency Tracking**: Bundle cache keys don't include dependency hashes
6. **Userland Config Complexity**: 40+ config options affect code paths
7. **12+ HTTP Clients**: Inconsistent retry, timeout, and error handling

### Medium Priority Issues

8. **Runtime Conditionals**: 84 files with runtime checks outside adapter layer
9. **Import Rewriting**: 7 implementations with ~230 lines duplicated
10. **Timeout Chaos**: 100+ hardcoded values with no hierarchy

---

## Success Metrics

After addressing these issues:

1. **Zero adapter-specific conditionals** in business logic
2. **All global state replaced** with request-scoped context (AsyncLocalStorage)
3. **Cache hit and miss paths** produce identical results
4. **Single code path** for layout/route discovery regardless of adapter
5. **Dependency tracking** for all cached bundles
6. **Runtime detection** only at adapter layer, not in business logic
7. **Single error handling pattern** with no silent failures
8. **Unified HTTP client** with consistent retry/timeout
9. **Centralized timeout configuration** with hierarchy

---

## Implementation Priority

### Phase 1: Stop the Bleeding (Week 1-2)
- **Add per-project resource limits** (semaphores, in-progress tracking)
- **Add content validation** before caching to prevent corruption spread
- Add integration tests running same request through all adapters
- Add assertions for request context isolation
- Fix App Router nested layouts in API adapter
- Enable error logging in production

### Phase 2: Unify Core Systems (Week 3-6)
- Create unified adapter interface with `walkDirectory` support
- Project-scope all caches
- Implement dependency tracking in bundle cache
- Consolidate global state to AsyncLocalStorage

### Phase 3: Consolidate Implementations (Week 7-10)
- Merge import rewriters into single system
- Unify HTTP clients
- Centralize timeout configuration
- Unify error handling

### Phase 4: Clean Up (Week 11-12)
- Remove runtime conditionals from business logic
- Normalize config formats at load time
- Document all remaining intentional divergence

---

## References

- **GitHub RFC**: https://github.com/veryfront/veryfront-renderer/issues/185
- **Original analysis date**: 2025-01-27
- **Codebase**: `/Users/mattboon/Sites/veryfront-renderer/`

---

## Chapter Index

1. [001 - File Adapter Divergence](./001-adapter-divergence.md)
2. [002 - Global State & Multi-Tenant Isolation](./002-global-state.md)
3. [003 - Cache Hit vs Miss Behavior](./003-cache-behavior.md)
4. [004 - Bundle Dependency Tracking](./004-bundle-dependencies.md)
5. [005 - App Router vs Pages Router](./005-router-divergence.md)
6. [006 - Runtime Conditional Branching](./006-runtime-conditionals.md)
7. [007 - Config Format Normalization](./007-config-normalization.md)
8. [008 - Userland Config Code Paths](./008-userland-config.md)
9. [009 - Timeout Handling](./009-timeout-handling.md)
10. [010 - Error Handling & Silent Failures](./010-error-handling.md)
11. [011 - Import Rewriting Implementations](./011-import-rewriting.md)
12. [012 - HTTP Client Implementations](./012-http-clients.md)
13. [013 - Cache Key Patterns & Storage](./013-cache-key-patterns.md)
