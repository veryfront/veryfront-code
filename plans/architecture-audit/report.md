# Veryfront Renderer Architecture Audit

## Executive Summary for Leadership

This audit identifies critical architectural issues causing **production instability** and **unpredictable behavior** across environments. The root cause: conditional logic based on adapter type, router type, runtime, cache state, and configuration creates a **combinatorial explosion of code paths**.

```
Adapters (3) × Routers (2) × Runtimes (3) × Cache States (2) × Config Variations = 100s of code paths
```

Each combination can exhibit different behavior, making bugs that "work locally but break in production" endemic.

---

## 🔴 SECURITY CRITICAL

**[008.2 - Unsafe Config Execution](./008.2-unsafe-config-execution.md)** - User `veryfront.config.ts` executes with FULL renderer permissions. A malicious config can exfiltrate secrets, read files, and affect other tenants.

---

## 🏗️ Core Architecture Principle

**Singleton Renderer + AsyncLocalStorage for Request Isolation**

```
┌─────────────────────────────────────────────────────────────────┐
│                     SINGLETON RENDERER                          │
│                  (one process, all projects)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Request A (project-alpha)    Request B (project-beta)         │
│          │                            │                         │
│          ▼                            ▼                         │
│   ┌─────────────────┐         ┌─────────────────┐              │
│   │ AsyncLocalStorage│         │ AsyncLocalStorage│              │
│   │ context: alpha   │         │ context: beta    │              │
│   │ - headCollector  │         │ - headCollector  │              │
│   │ - ssrContext     │         │ - ssrContext     │              │
│   │ - runtimeConfig  │         │ - runtimeConfig  │              │
│   └─────────────────┘         └─────────────────┘              │
│                                                                 │
│   SHARED (safe):              ISOLATED (per-request):           │
│   - Content-addressed caches  - Head collector state            │
│   - HTTP connection pools     - SSR context/domain              │
│   - Read-only config          - Runtime config                  │
│   - Module registry           - Error collector                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why this pattern:**
- **Singleton renderer** - Performance (no per-request process overhead)
- **AsyncLocalStorage** - Correctness (request isolation without code changes)
- **Content-addressed caches shared** - Same input = same output, safe to share

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
- **Solution: AsyncLocalStorage for all request-scoped state**

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
- **Solution: Unified adapter interface ([001.0 RFC](./001.0-unified-adapter-rfc.md))**

### 5. Cache Consistency
**Same behavior when cached and uncached.**
- Cache hit produces identical result to cache miss
- No stale cache bugs
- No "clear cache to fix" workarounds
- Deterministic output regardless of cache state
- **Solution: Include dependency hash in cache keys ([004.0 RFC](./004.0-dependency-tracking-rfc.md))**

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

## Chapters & RFCs

### Core Divergence Issues

| # | Chapter | RFC | Risk | Key Issue |
|---|---------|-----|------|-----------|
| [001](./001-adapter-divergence.md) | File Adapter Divergence | [001.0](./001.0-unified-adapter-rfc.md) | **CRITICAL** | Layout discovery differs by adapter |
| [002](./002-global-state.md) | Global State & Multi-Tenant | [002.0](./002.0-request-scoped-state-rfc.md) | **CRITICAL** | 15+ globals leak between projects |
| [003](./003-cache-behavior.md) | Cache Hit vs Miss | [003.0](./003.0-cache-consistency-rfc.md) | **HIGH** | Cache hit skips validation |
| [004](./004-bundle-dependencies.md) | Bundle Dependencies | [004.0](./004.0-dependency-tracking-rfc.md) | **HIGH** | Cache keys miss dep changes |
| [005](./005-router-divergence.md) | Router Divergence | [005.0](./005.0-router-unification-rfc.md) | **MEDIUM** | App/Pages Router differ |
| [006](./006-runtime-conditionals.md) | Runtime Conditionals | [006.0](./006.0-environment-detection-rfc.md) | **MEDIUM** | 84 files with runtime checks |

### Configuration & Input Handling

| # | Chapter | RFC | Risk | Key Issue |
|---|---------|-----|------|-----------|
| [007](./007-config-normalization.md) | Config Normalization | [007.0](./007.0-config-normalization-rfc.md) | **CRITICAL** | Global singleton config |
| [008](./008-userland-config.md) | Userland Config | [008.0](./008.0-userland-config-rfc.md) | **🔴 CRITICAL** | [008.2](./008.2-unsafe-config-execution.md): Arbitrary code execution |

### Implementation Fragmentation

| # | Chapter | RFC | Risk | Key Issue |
|---|---------|-----|------|-----------|
| [009](./009-timeout-handling.md) | Timeout Handling | [009.0](./009.0-timeout-handling-rfc.md) | **CRITICAL** | Global semaphores block all projects |
| [010](./010-error-handling.md) | Error Handling | [010.0](./010.0-error-handling-rfc.md) | **HIGH** | Global failedComponents leaks |
| [011](./011-import-rewriting.md) | Import Rewriting | [011.0](./011.0-import-rewriting-rfc.md) | **HIGH** | SSR/browser resolution differs |
| [012](./012-http-clients.md) | HTTP Clients | [012.0](./012.0-http-clients-rfc.md) | **HIGH** | 6/8 clients missing timeouts |

### Infrastructure

| # | Chapter | RFC | Risk | Key Issue |
|---|---------|-----|------|-----------|
| [013](./013-cache-key-patterns.md) | Cache Key Patterns | [013.0](./013.0-cache-key-patterns-rfc.md) | **MEDIUM** | Agent cache missing projectId |
| [014](./014-deployment-modes.md) | Deployment Modes | [014.0](./014.0-deployment-modes-rfc.md) | **HIGH** | Combined/split mode diverge |
| [015](./015-testability.md) | Testability | [015.0](./015.0-testability-rfc.md) | **HIGH** | No multi-tenant test utilities |

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

| # | Chapter | RFC | Sub-Docs |
|---|---------|-----|----------|
| 001 | [Adapter Divergence](./001-adapter-divergence.md) | [001.0](./001.0-unified-adapter-rfc.md) | [001.1](./001.1-layout-bug-critical.md), [001.2](./001.2-unsafe-type-casting.md), [001.3](./001.3-duplicated-isvirtualfilesystem.md), [001.4](./001.4-layout-cache-no-project-scope.md), [001.5](./001.5-config-middleware-loading-divergence.md), [001.6](./001.6-css-cache-key-divergence.md) |
| 002 | [Global State](./002-global-state.md) | [002.0](./002.0-request-scoped-state-rfc.md) | [002.1](./002.1-head-collector-leakage.md), [002.2](./002.2-ssr-globals-context-leakage.md), [002.3](./002.3-react-cache-version-mismatch.md), [002.4](./002.4-semaphore-starvation.md), [002.5](./002.5-ai-registry-leakage.md), [002.6](./002.6-in-progress-deadlock.md), [002.7](./002.7-failed-components-collision.md), [002.8](./002.8-tailwind-compiler-state.md) |
| 003 | [Cache Behavior](./003-cache-behavior.md) | [003.0](./003.0-cache-consistency-rfc.md) | [003.1](./003.1-ssr-module-path-mismatch.md), [003.2](./003.2-http-bundle-ttl-mismatch.md), [003.3](./003.3-multitenancy-cache-isolation.md), [003.4](./003.4-cache-hit-validation-skipped.md) |
| 004 | [Bundle Dependencies](./004-bundle-dependencies.md) | [004.0](./004.0-dependency-tracking-rfc.md) | [004.1](./004.1-transform-cache-no-deps-hash.md), [004.2](./004.2-unused-depshash-infrastructure.md), [004.3](./004.3-mdx-import-tracking-gap.md), [004.4](./004.4-npm-esm-package-version-drift.md), [004.5](./004.5-ssr-module-loader-staleness.md), [004.6](./004.6-config-changes-not-invalidating.md) |
| 005 | [Router Divergence](./005-router-divergence.md) | [005.0](./005.0-router-unification-rfc.md) | [005.1](./005.1-global-router-detection-cache.md), [005.2](./005.2-ssg-getallpages-missing-app-router.md), [005.3](./005.3-duplicated-route-params-extraction.md), [005.4](./005.4-layout-collector-router-branching.md), [005.5](./005.5-dynamic-route-handling-inconsistency.md) |
| 006 | [Runtime Conditionals](./006-runtime-conditionals.md) | [006.0](./006.0-environment-detection-rfc.md) | [006.1](./006.1-ssr-detection-inconsistencies.md), [006.2](./006.2-redundant-runtime-detection.md), [006.3](./006.3-module-loading-conditionals.md) |
| 007 | [Config Normalization](./007-config-normalization.md) | [007.0](./007.0-config-normalization-rfc.md) | [007.1](./007.1-router-format-mismatch.md), [007.2](./007.2-cors-schema-runtime-mismatch.md), [007.3](./007.3-default-config-shared-reference.md), [007.4](./007.4-layout-tristate-inconsistency.md), [007.5](./007.5-cache-enabled-type-confusion.md), [007.6](./007.6-security-config-cors-default-mutation.md), [007.7](./007.7-runtime-config-global-singleton.md) |
| 008 | [Userland Config](./008-userland-config.md) | [008.0](./008.0-userland-config-rfc.md) | [008.1](./008.1-global-config-cache-pollution.md), **[008.2](./008.2-unsafe-config-execution.md)** 🔴, [008.3](./008.3-temp-file-race-condition.md), [008.4](./008.4-hmr-cache-invalidation-incomplete.md), [008.5](./008.5-config-schema-validation-gaps.md) |
| 009 | [Timeout Handling](./009-timeout-handling.md) | [009.0](./009.0-timeout-handling-rfc.md) | [009.1](./009.1-global-semaphores-no-project-isolation.md), [009.2](./009.2-fetch-calls-without-timeout.md), [009.3](./009.3-timeout-hierarchy-violations.md), [009.4](./009.4-in-flight-maps-no-timeout-cleanup.md), [009.5](./009.5-hardcoded-timeout-values.md), [009.6](./009.6-duplicate-timeout-definitions.md) |
| 010 | [Error Handling](./010-error-handling.md) | [010.0](./010.0-error-handling-rfc.md) | [010.1](./010.1-failed-components-global-state.md), [010.2](./010.2-global-error-collector.md), [010.3](./010.3-dual-veryfront-error-definitions.md), [010.4](./010.4-witherrorcontext-silent-failures.md), [010.5](./010.5-wraperror-stack-trace-loss.md), [010.6](./010.6-inconsistent-500-responses.md) |
| 011 | [Import Rewriting](./011-import-rewriting.md) | [011.0](./011.0-import-rewriting-rfc.md) | [011.1](./011.1-global-warning-state-pollution.md), [011.2](./011.2-ssr-browser-resolution-divergence.md), [011.3](./011.3-regex-vs-lexer-inconsistencies.md), [011.4](./011.4-multiple-parsing-passes.md), [011.5](./011.5-import-map-resolution-gaps.md) |
| 012 | [HTTP Clients](./012-http-clients.md) | [012.0](./012.0-http-clients-rfc.md) | [012.1](./012.1-missing-timeouts.md), [012.2](./012.2-retry-duplication.md), [012.3](./012.3-module-cache-isolation.md), [012.4](./012.4-domain-cache-unbounded.md), [012.5](./012.5-no-circuit-breaker.md) |
| 013 | [Cache Key Patterns](./013-cache-key-patterns.md) | [013.0](./013.0-cache-key-patterns-rfc.md) | [013.1](./013.1-content-addressed-vs-identity-caching.md), [013.2](./013.2-agent-cache-project-isolation.md), [013.3](./013.3-key-format-standardization.md) |
| 014 | [Deployment Modes](./014-deployment-modes.md) | [014.0](./014.0-deployment-modes-rfc.md) | [014.1](./014.1-node-env-missing.md), [014.2](./014.2-missing-release-id.md), [014.3](./014.3-combined-split-divergence.md), [014.4](./014.4-cache-ttl-misclassification.md), [014.5](./014.5-header-domain-conflicts.md) |
| 015 | [Testability](./015-testability.md) | [015.0](./015.0-testability-rfc.md) | [015.1](./015.1-global-state-test-isolation.md), [015.2](./015.2-missing-multi-tenant-test-utilities.md), [015.3](./015.3-test-determinism-issues.md), [015.4](./015.4-cross-adapter-test-coverage-gaps.md), [015.5](./015.5-ci-test-integration-gaps.md) |
