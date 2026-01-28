# RFC: Architecture Audit - Reduce Complexity & Fix Multi-Tenant Issues

> **TL;DR**: One broken project can crash ALL projects. This audit documents 57 tasks across 19 chapters to fix multi-tenancy, eliminate "works locally, breaks in production", and establish architectural patterns.

---

## 📋 How to Review This PR

| If you want to... | Go to... |
|-------------------|----------|
| Understand the problem | [The Problem](#the-problem-were-solving) |
| See what we're committing to | [Must-Haves](#must-haves-non-negotiable) |
| **Make decisions (ACTION REQUIRED)** | [Decisions](#decisions-requiring-sign-off) |
| See all work items | [Tasks by Priority](#tasks-57-total) |
| Understand the architecture | [Architecture Diagrams](#architecture) |
| Know what to avoid | [Gotchas](#%EF%B8%8F-gotchas--things-to-watch) |

### Quick Links

| Document | What's in it |
|----------|--------------|
| 📊 [report.md](./plans/architecture-audit/report.md) | Executive summary for leadership |
| ✅ [DECISIONS.md](./plans/architecture-audit/tasks/DECISIONS.md) | **15 decisions needing sign-off** |
| 📝 [tasks/README.md](./plans/architecture-audit/tasks/README.md) | 57 tasks with execution order |

---

## The Problem We're Solving

The veryfront-renderer serves **multiple projects from a single process**. One renderer pod handles requests for `projectA.veryfront.com`, `projectB.veryfront.com`, etc.

**Current state is broken:**
- 🔴 One project's bug can take down ALL projects
- 🔴 SSR metadata leaks between projects (wrong titles, OG tags)
- 🔴 "Works locally, breaks in production" is endemic
- 🔴 150+ silent error swallows make debugging impossible

```
Adapters (3) × Routers (2) × Runtimes (3) × Cache States (2) × Config = 100s of code paths
```

---

## Must-Haves (Non-Negotiable)

| # | Requirement | What it means |
|---|-------------|---------------|
| 1 | **Zero side effects on startup** | `deno task start` must not cache, fetch, or mutate state |
| 2 | **Complete project isolation** | One broken project cannot affect others |
| 3 | **Local mirrors remote** | Preview/production mode identical to deployed |
| 4 | **Adapter parity** | Local FS, API, and GitHub adapters behave identically |
| 5 | **Cache consistency** | Cache hit produces identical result to cache miss |

---

## Decisions Requiring Sign-Off

> ⚠️ **ACTION REQUIRED**: 14 decisions need your input before implementation can begin.

**[→ View full decision details in DECISIONS.md](./plans/architecture-audit/tasks/DECISIONS.md)**

### Status Summary

| Status | Count | Meaning |
|--------|-------|---------|
| ✅ DECIDED | 1 | Ready to implement |
| 🟡 PROPOSED | 7 | Has recommendation, needs approval |
| 🔴 OPEN | 7 | Needs discussion |

### All Decisions

| # | Status | Question | Recommendation | Blocks |
|---|--------|----------|----------------|--------|
| D001 | 🟡 | Config file format? | JSON + env vars (prod), TS sandbox (dev) | Task 001 |
| D002 | 🟡 | AsyncLocalStorage scope? | projectId, slug, env, headCollector, ssrContext | Tasks 002-005, 007, 009, 029 |
| D003 | 🟡 | Cache strategy? | Content-addressed for transforms, identity for renders | Tasks 011, 026, 027 |
| D004 | 🟡 | Cache key format? | `v{ver}:{type}:{scope?}:{id}:{hash}` | Task 027 |
| D005 | 🔴 | Semaphore limits? | Need per-project + global values | Task 006 |
| D006 | 🟡 | Timeout hierarchy? | Request 60s → Pipeline 45s → Stage 30s → IO 15s | Task 023 |
| D007 | 🔴 | Error response format? | HTML for browsers, JSON for API | Task 024 |
| D008 | 🟡 | Adapter interface? | 4 methods: readFile, readFileBinary, fileExists, walkDirectory | Task 016 |
| D009 | ✅ | React version strategy? | **`veryfront.config.react.version`** | Task 008 |
| D010 | 🔴 | Test utility API? | `withConcurrentTenants()` or `verifyConcurrentIsolation()` | Task 032 |
| D011 | 🔴 | Path validation? | Centralized utility recommended | Task 043 |
| D012 | 🔴 | Cache eviction? | LRU + TTL hybrid recommended | Tasks 053, 054 |
| D013 | 🔴 | Cache size limits? | Per-cache limits recommended | Tasks 053, 054 |
| D014 | 🔴 | Naming conventions? | handler/middleware, ctx/context, boolean prefixes | Task 057 |
| D015 | 🔴 | File decomposition? | Incremental (one per sprint) recommended | Task 056 |

### D009: React Version (DECIDED)

| Before | After |
|--------|-------|
| React version detected from first project to render | Explicit `veryfront.config.react.version` |
| Version cached globally → conflicts | Version per-project from config |
| `projectReactCache` global singleton | `reactCacheByVersion` Map keyed by version |

```typescript
// veryfront.config.ts
export default {
  react: {
    version: "18.3.1"
  }
}
```

---

## Documentation Structure

### Chapters (001-019)

| # | Chapter | RFC | Risk | Sub-Issues |
|---|---------|-----|------|------------|
| 001 | [Adapter Divergence](./plans/architecture-audit/001-adapter-divergence.md) | [001.0](./plans/architecture-audit/001.0-unified-adapter-rfc.md) | 🔴 CRITICAL | 6 |
| 002 | [Global State](./plans/architecture-audit/002-global-state.md) | [002.0](./plans/architecture-audit/002.0-request-scoped-state-rfc.md) | 🔴 CRITICAL | 9 |
| 003 | [Cache Behavior](./plans/architecture-audit/003-cache-behavior.md) | [003.0](./plans/architecture-audit/003.0-cache-consistency-rfc.md) | 🟠 HIGH | 4 |
| 004 | [Bundle Dependencies](./plans/architecture-audit/004-bundle-dependencies.md) | [004.0](./plans/architecture-audit/004.0-dependency-tracking-rfc.md) | 🟠 HIGH | 6 |
| 005 | [Router Divergence](./plans/architecture-audit/005-router-divergence.md) | [005.0](./plans/architecture-audit/005.0-router-unification-rfc.md) | 🟡 MEDIUM | 5 |
| 006 | [Runtime Conditionals](./plans/architecture-audit/006-runtime-conditionals.md) | [006.0](./plans/architecture-audit/006.0-environment-detection-rfc.md) | 🟡 MEDIUM | 3 |
| 007 | [Config Normalization](./plans/architecture-audit/007-config-normalization.md) | [007.0](./plans/architecture-audit/007.0-config-normalization-rfc.md) | 🟢 LOW | 7 |
| 008 | [Userland Config](./plans/architecture-audit/008-userland-config.md) | [008.0](./plans/architecture-audit/008.0-userland-config-rfc.md) | 🟠 HIGH | 5 |
| 009 | [Timeout Handling](./plans/architecture-audit/009-timeout-handling.md) | [009.0](./plans/architecture-audit/009.0-timeout-handling-rfc.md) | 🟡 MEDIUM | 6 |
| 010 | [Error Handling](./plans/architecture-audit/010-error-handling.md) | [010.0](./plans/architecture-audit/010.0-error-handling-rfc.md) | 🟠 HIGH | 6 |
| 011 | [Import Rewriting](./plans/architecture-audit/011-import-rewriting.md) | [011.0](./plans/architecture-audit/011.0-import-rewriting-rfc.md) | 🟡 MEDIUM | 5 |
| 012 | [HTTP Clients](./plans/architecture-audit/012-http-clients.md) | [012.0](./plans/architecture-audit/012.0-http-clients-rfc.md) | 🟡 MEDIUM | 5 |
| 013 | [Cache Key Patterns](./plans/architecture-audit/013-cache-key-patterns.md) | [013.0](./plans/architecture-audit/013.0-cache-key-patterns-rfc.md) | 🟠 HIGH | 3 |
| 014 | [Deployment Modes](./plans/architecture-audit/014-deployment-modes.md) | [014.0](./plans/architecture-audit/014.0-deployment-modes-rfc.md) | 🟠 HIGH | 5 |
| 015 | [Testability](./plans/architecture-audit/015-testability.md) | [015.0](./plans/architecture-audit/015.0-testability-rfc.md) | 🟠 HIGH | 5 |
| 016 | [Security Gaps](./plans/architecture-audit/016-security-gaps.md) | - | 🔴 CRITICAL | 5 |
| 017 | [Race Conditions](./plans/architecture-audit/017-race-conditions.md) | - | 🔴 CRITICAL | 5 |
| 018 | [Memory Leaks](./plans/architecture-audit/018-memory-leaks.md) | - | 🟠 HIGH | 5 |
| 019 | [Code Quality](./plans/architecture-audit/019-code-quality.md) | - | 🟡 MEDIUM | 5 |

---

## Tasks (57 Total)

### Summary by Priority

| Priority | Count | Focus | Sprint |
|----------|-------|-------|--------|
| **P0** | 9 | 🔒 Security & Foundation | 1 |
| **P1** | 13 | 🏗️ Multi-tenant stability | 1-2 |
| **P2** | 18 | 💾 Cache correctness & Memory | 2-3 |
| **P3** | 9 | 🔌 Adapter parity | 3-4 |
| **P4** | 8 | 🧹 Code consolidation | Ongoing |

### P0 - Security & Foundation (Do First)

| # | Task | Category | Issue |
|---|------|----------|-------|
| [040](./plans/architecture-audit/tasks/040-timing-safe-compare.md) | Timing-Safe Compare | 🔒 Security | [016.1](./plans/architecture-audit/016.1-timing-attack.md) |
| [041](./plans/architecture-audit/tasks/041-innerhtml-sanitization.md) | innerHTML Sanitization | 🔒 Security | [016.2](./plans/architecture-audit/016.2-innerhtml-sanitization.md) |
| [042](./plans/architecture-audit/tasks/042-sandbox-function-restriction.md) | Sandbox Function Restriction | 🔒 Security | [016.3](./plans/architecture-audit/016.3-sandbox-escape.md) |
| [001](./plans/architecture-audit/tasks/001-sandbox-config-execution.md) | Sandbox Config Execution | 🔒 Security | [008.2](./plans/architecture-audit/008.2-unsafe-config-execution.md) |
| [026](./plans/architecture-audit/tasks/026-caching-strategy.md) | Caching Strategy | 🏗️ Foundation | [003.0](./plans/architecture-audit/003.0-cache-consistency-rfc.md) |
| [002](./plans/architecture-audit/tasks/002-request-context-foundation.md) | Request Context Foundation | 🏗️ Foundation | [002.0](./plans/architecture-audit/002.0-request-scoped-state-rfc.md) |
| [003](./plans/architecture-audit/tasks/003-head-collector-isolation.md) | Head Collector Isolation | 🏗️ Foundation | [002.1](./plans/architecture-audit/002.1-head-collector-leakage.md) |
| [004](./plans/architecture-audit/tasks/004-ssr-globals-isolation.md) | SSR Globals Isolation | 🏗️ Foundation | [002.2](./plans/architecture-audit/002.2-ssr-globals-context-leakage.md) |
| [005](./plans/architecture-audit/tasks/005-runtime-config-isolation.md) | Runtime Config Isolation | 🏗️ Foundation | [007.7](./plans/architecture-audit/007.7-runtime-config-global-singleton.md) |

### P1 - Multi-Tenant Stability

| # | Task | Category | Issue |
|---|------|----------|-------|
| [006](./plans/architecture-audit/tasks/006-per-project-semaphores.md) | Per-Project Semaphores | 🏗️ Isolation | [002.4](./plans/architecture-audit/002.4-semaphore-starvation.md) |
| [007](./plans/architecture-audit/tasks/007-failed-components-isolation.md) | Failed Components Isolation | 🏗️ Isolation | [002.7](./plans/architecture-audit/002.7-failed-components-collision.md) |
| [008](./plans/architecture-audit/tasks/008-react-cache-by-version.md) | React Cache by Version | 🏗️ Isolation | [002.3](./plans/architecture-audit/002.3-react-cache-version-mismatch.md) |
| [009](./plans/architecture-audit/tasks/009-ai-registry-per-project.md) | AI Registry Per-Project | 🏗️ Isolation | [002.5](./plans/architecture-audit/002.5-ai-registry-leakage.md) |
| [010](./plans/architecture-audit/tasks/010-tailwind-compiler-isolation.md) | Tailwind Compiler Isolation | 🏗️ Isolation | [002.8](./plans/architecture-audit/002.8-tailwind-compiler-state.md) |
| [039](./plans/architecture-audit/tasks/039-tailwind-cache-environment-scope.md) | Tailwind Cache Env Scope | 🏗️ Isolation | [002.9](./plans/architecture-audit/002.9-tailwind-cache-environment-scope.md) |
| [027](./plans/architecture-audit/tasks/027-cache-key-standard.md) | Cache Key Standard | 💾 Cache | [013.0](./plans/architecture-audit/013.0-cache-key-patterns-rfc.md) |
| [028](./plans/architecture-audit/tasks/028-in-flight-deduplication.md) | In-Flight Deduplication | 💾 Cache | [002.6](./plans/architecture-audit/002.6-in-progress-deadlock.md) |
| [029](./plans/architecture-audit/tasks/029-error-collector-isolation.md) | Error Collector Isolation | 🏗️ Isolation | [010.2](./plans/architecture-audit/010.2-global-error-collector.md) |
| [035](./plans/architecture-audit/tasks/035-fetch-timeout-coverage.md) | Fetch Timeout Coverage | ⏱️ Reliability | [009.2](./plans/architecture-audit/009.2-fetch-calls-without-timeout.md) |
| [043](./plans/architecture-audit/tasks/043-path-traversal-validation.md) | Path Traversal Validation | 🔒 Security | [016.4](./plans/architecture-audit/016.4-path-traversal.md) |
| [044](./plans/architecture-audit/tasks/044-json-parse-safety.md) | JSON.parse Safety | 🔒 Security | [016.5](./plans/architecture-audit/016.5-json-parse-validation.md) |
| [045](./plans/architecture-audit/tasks/045-memoize-inflight-dedup.md) | Memoize In-Flight Dedup | ⚡ Race Condition | [017.1](./plans/architecture-audit/017.1-cache-stampede.md) |
| [046](./plans/architecture-audit/tasks/046-regex-state-isolation.md) | Regex State Isolation | ⚡ Race Condition | [017.2](./plans/architecture-audit/017.2-global-regex-state.md) |

### P2 - Cache & Memory

| # | Task | Category | Issue |
|---|------|----------|-------|
| [011](./plans/architecture-audit/tasks/011-transform-cache-deps-hash.md) | Transform Cache Deps Hash | 💾 Cache | [004.1](./plans/architecture-audit/004.1-transform-cache-no-deps-hash.md) |
| [012](./plans/architecture-audit/tasks/012-cache-hit-validation.md) | Cache Hit Validation | 💾 Cache | [003.4](./plans/architecture-audit/003.4-cache-hit-validation-skipped.md) |
| [013](./plans/architecture-audit/tasks/013-ssr-module-path-consistency.md) | SSR Module Path Consistency | 💾 Cache | [003.1](./plans/architecture-audit/003.1-ssr-module-path-mismatch.md) |
| [014](./plans/architecture-audit/tasks/014-config-change-invalidation.md) | Config Change Invalidation | 💾 Cache | [004.6](./plans/architecture-audit/004.6-config-changes-not-invalidating.md) |
| [015](./plans/architecture-audit/tasks/015-http-bundle-ttl-fix.md) | HTTP Bundle TTL Fix | 💾 Cache | [003.2](./plans/architecture-audit/003.2-http-bundle-ttl-mismatch.md) |
| [030](./plans/architecture-audit/tasks/030-ssg-app-router-support.md) | SSG App Router Support | 🔌 Router | [005.2](./plans/architecture-audit/005.2-ssg-getallpages-missing-app-router.md) |
| [031](./plans/architecture-audit/tasks/031-deployment-mode-consistency.md) | Deployment Mode Consistency | 🚀 Deploy | [014.0](./plans/architecture-audit/014.0-deployment-modes-rfc.md) |
| [032](./plans/architecture-audit/tasks/032-multi-tenant-test-utils.md) | Multi-Tenant Test Utils | 🧪 Testing | [015.0](./plans/architecture-audit/015.0-testability-rfc.md) |
| [034](./plans/architecture-audit/tasks/034-config-schema-validation.md) | Config Schema Validation | ⚙️ Config | [007.0](./plans/architecture-audit/007.0-config-normalization-rfc.md) |
| [036](./plans/architecture-audit/tasks/036-dependency-tracking-complete.md) | Dependency Tracking | 💾 Cache | [004.0](./plans/architecture-audit/004.0-dependency-tracking-rfc.md) |
| [038](./plans/architecture-audit/tasks/038-agent-cache-isolation.md) | Agent Cache Isolation | 💾 Cache | [013.2](./plans/architecture-audit/013.2-agent-cache-project-isolation.md) |
| [047](./plans/architecture-audit/tasks/047-lazy-singleton-mutex.md) | Lazy Singleton Mutex | ⚡ Race Condition | [017.3](./plans/architecture-audit/017.3-lazy-singleton-locking.md) |
| [048](./plans/architecture-audit/tasks/048-rate-limit-atomic.md) | Rate Limit Atomic | ⚡ Race Condition | [017.4](./plans/architecture-audit/017.4-rate-limit-atomicity.md) |
| [049](./plans/architecture-audit/tasks/049-config-reload-atomic.md) | Config Reload Atomic | ⚡ Race Condition | [017.5](./plans/architecture-audit/017.5-config-reload-race.md) |
| [050](./plans/architecture-audit/tasks/050-hmr-client-cleanup.md) | HMR Client Cleanup | 🧠 Memory | [018.1](./plans/architecture-audit/018.1-hmr-client-map.md) |
| [051](./plans/architecture-audit/tasks/051-websocket-timer-cleanup.md) | WebSocket Timer Cleanup | 🧠 Memory | [018.2](./plans/architecture-audit/018.2-websocket-timer-cleanup.md) |
| [053](./plans/architecture-audit/tasks/053-module-cache-lru.md) | Module Cache LRU | 🧠 Memory | [018.4](./plans/architecture-audit/018.4-module-cache-bounds.md) |
| [054](./plans/architecture-audit/tasks/054-transform-cache-lru.md) | Transform Cache LRU | 🧠 Memory | [018.5](./plans/architecture-audit/018.5-transform-cache-eviction.md) |

### P3 - Adapter Parity

| # | Task | Category | Issue |
|---|------|----------|-------|
| [016](./plans/architecture-audit/tasks/016-unified-adapter-interface.md) | Unified Adapter Interface | 🔌 Adapter | [001.0](./plans/architecture-audit/001.0-unified-adapter-rfc.md) |
| [017](./plans/architecture-audit/tasks/017-layout-discovery-unify.md) | Layout Discovery Unify | 🔌 Adapter | [001.1](./plans/architecture-audit/001.1-layout-bug-critical.md) |
| [018](./plans/architecture-audit/tasks/018-config-middleware-parity.md) | Config/Middleware Parity | 🔌 Adapter | [001.5](./plans/architecture-audit/001.5-config-middleware-loading-divergence.md) |
| [019](./plans/architecture-audit/tasks/019-css-cache-key-fix.md) | CSS Cache Key Fix | 🔌 Adapter | [001.6](./plans/architecture-audit/001.6-css-cache-key-divergence.md) |
| [020](./plans/architecture-audit/tasks/020-router-detection-cache-fix.md) | Router Detection Cache | 🔌 Router | [005.1](./plans/architecture-audit/005.1-global-router-detection-cache.md) |
| [033](./plans/architecture-audit/tasks/033-type-safety-adapter-checks.md) | Type Safety | 🔌 Adapter | [001.2](./plans/architecture-audit/001.2-unsafe-type-casting.md) |
| [037](./plans/architecture-audit/tasks/037-router-param-unification.md) | Router Param Unification | 🔌 Router | [005.3](./plans/architecture-audit/005.3-duplicated-route-params-extraction.md) |
| [052](./plans/architecture-audit/tasks/052-event-listener-cleanup.md) | Event Listener Cleanup | 🧠 Memory | [018.3](./plans/architecture-audit/018.3-event-listener-cleanup.md) |

### P4 - Code Consolidation

| # | Task | Category | Issue |
|---|------|----------|-------|
| [021](./plans/architecture-audit/tasks/021-import-rewriter-unify.md) | Import Rewriter Unify | 🧹 Consolidate | [011.0](./plans/architecture-audit/011.0-import-rewriting-rfc.md) |
| [022](./plans/architecture-audit/tasks/022-http-client-consolidate.md) | HTTP Client Consolidate | 🧹 Consolidate | [012.0](./plans/architecture-audit/012.0-http-clients-rfc.md) |
| [023](./plans/architecture-audit/tasks/023-timeout-centralization.md) | Timeout Centralization | 🧹 Consolidate | [009.0](./plans/architecture-audit/009.0-timeout-handling-rfc.md) |
| [024](./plans/architecture-audit/tasks/024-error-handling-patterns.md) | Error Handling Patterns | 🧹 Consolidate | [010.0](./plans/architecture-audit/010.0-error-handling-rfc.md) |
| [025](./plans/architecture-audit/tasks/025-environment-detection-unify.md) | Environment Detection | 🧹 Consolidate | [006.0](./plans/architecture-audit/006.0-environment-detection-rfc.md) |
| [055](./plans/architecture-audit/tasks/055-path-utils-consolidation.md) | Path Utils Consolidation | 🧹 Consolidate | [019.1](./plans/architecture-audit/019.1-getextension-duplication.md) |
| [056](./plans/architecture-audit/tasks/056-large-file-decomposition.md) | Large File Decomposition | 🧹 Consolidate | [019.4](./plans/architecture-audit/019.4-file-complexity.md) |
| [057](./plans/architecture-audit/tasks/057-naming-conventions.md) | Naming Conventions | 🧹 Consolidate | [019.5](./plans/architecture-audit/019.5-naming-inconsistencies.md) |

---

## Coverage Matrix

Every chapter has corresponding tasks. No gaps.

| Chapter | Sub-Issues | Tasks |
|---------|------------|-------|
| 001 Adapter Divergence | 001.1-001.6 | 016, 017, 018, 019, 033 |
| 002 Global State | 002.1-002.9 | 002, 003, 004, 005, 006, 007, 008, 009, 010, 028, 039 |
| 003 Cache Behavior | 003.1-003.4 | 012, 013, 015, 026 |
| 004 Bundle Dependencies | 004.1-004.6 | 011, 014, 036 |
| 005 Router Divergence | 005.1-005.5 | 020, 030, 037 |
| 006 Runtime Conditionals | 006.1-006.3 | 025 |
| 007 Config Normalization | 007.1-007.7 | 005, 034 |
| 008 Userland Config | 008.1-008.5 | 001, 014, 034 |
| 009 Timeout Handling | 009.1-009.6 | 006, 023, 028, 035 |
| 010 Error Handling | 010.1-010.6 | 007, 024, 029 |
| 011 Import Rewriting | 011.1-011.5 | 021 |
| 012 HTTP Clients | 012.1-012.5 | 022 |
| 013 Cache Key Patterns | 013.1-013.3 | 026, 027, 038 |
| 014 Deployment Modes | 014.1-014.5 | 015, 031 |
| 015 Testability | 015.1-015.5 | 032 |
| 016 Security Gaps | 016.1-016.5 | 040, 041, 042, 043, 044 |
| 017 Race Conditions | 017.1-017.5 | 045, 046, 047, 048, 049 |
| 018 Memory Leaks | 018.1-018.5 | 050, 051, 052, 053, 054 |
| 019 Code Quality | 019.1-019.5 | 055, 056, 057 |

---

## Architecture

### 1. The Problem: Combinatorial Explosion

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    COMBINATORIAL EXPLOSION                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ADAPTER          Local FS  ←───→  Veryfront API  ←───→  GitHub        │
│                       │                 │                  │            │
│                       ▼                 ▼                  ▼            │
│  ROUTER           App Router  ←─────────────→  Pages Router            │
│                       │                              │                  │
│                       ▼                              ▼                  │
│  RUNTIME          Deno  ←──→  Node  ←──→  Bun  ←──→  Cloudflare       │
│                       │          │          │                           │
│                       ▼          ▼          ▼                           │
│  CACHE            Hit  ←────────────────────→  Miss                    │
│                       │                         │                       │
│                       ▼                         ▼                       │
│  CONFIG           layout × router × fs.type × experimental.*          │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════   │
│  EACH CONDITIONAL MULTIPLIES CODE PATHS = "works locally, breaks prod" │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Target: Singleton + AsyncLocalStorage

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SINGLETON RENDERER                                 │
│                   (one process, all projects)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Request A (project-alpha)         Request B (project-beta)            │
│            │                                 │                          │
│            ▼                                 ▼                          │
│   ┌─────────────────────┐           ┌─────────────────────┐            │
│   │  AsyncLocalStorage  │           │  AsyncLocalStorage  │            │
│   │  context: alpha     │           │  context: beta      │            │
│   │  ─────────────────  │           │  ─────────────────  │            │
│   │  • projectId        │           │  • projectId        │            │
│   │  • headCollector    │           │  • headCollector    │            │
│   │  • ssrContext       │           │  • ssrContext       │            │
│   │  • runtimeConfig    │           │  • runtimeConfig    │            │
│   └─────────────────────┘           └─────────────────────┘            │
│                                                                         │
│   SHARED (safe):                    ISOLATED (per-request):            │
│   • Content-addressed caches        • Head collector state              │
│   • HTTP connection pools           • SSR context/domain                │
│   • Read-only config                • Runtime config                    │
│   • Module registry                 • Error collector                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3. Blast Radius (Current Problem)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   🔴 BLAST RADIUS - CURRENT STATE                       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Project A (broken)              Project B (healthy)                   │
│        │                                │                               │
│        ▼                                ▼                               │
│   ┌─────────┐                     ┌─────────┐                          │
│   │ Request │                     │ Request │                          │
│   └────┬────┘                     └────┬────┘                          │
│        │                                │                               │
│        │    ╔═══════════════════════════════════════════╗              │
│        │    ║         SHARED GLOBAL STATE               ║              │
│        │    ╠═══════════════════════════════════════════╣              │
│        ├───►║  transformSemaphore  [▓▓▓▓▓▓▓▓▓▓] FULL   ║◄────┤        │
│        │    ║  failedComponents    {/page: Error}       ║     │        │
│        │    ║  globalInProgress    {key: <pending>}     ║     │        │
│        │    ║  headCollector       {title: "A's title"} ║◄─── │ LEAK!  │
│        │    ╚═══════════════════════════════════════════╝     │        │
│        │                                                       │        │
│        ▼                                                       ▼        │
│   ┌─────────┐                                           ┌─────────┐    │
│   │  HANGS  │  ← A exhausts semaphore                   │ BLOCKED │    │
│   └─────────┘                                           └─────────┘    │
│                                                                         │
│   ONE BROKEN PROJECT TAKES DOWN ALL PROJECTS                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4. Request Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Browser                                                               │
│      │                                                                  │
│      │ GET https://myproject.veryfront.com/about                       │
│      ▼                                                                  │
│   ┌──────────────────┐                                                 │
│   │      PROXY       │  ← Extracts projectSlug from domain             │
│   │                  │  ← Fetches OAuth token (cached)                 │
│   │  x-project-slug  │  ← Adds headers                                 │
│   │  x-token         │                                                 │
│   │  x-environment   │                                                 │
│   └────────┬─────────┘                                                 │
│            │                                                            │
│            ▼                                                            │
│   ┌──────────────────┐                                                 │
│   │    RENDERER      │                                                 │
│   │                  │                                                 │
│   │  1. Parse headers────────────────────────────────┐                 │
│   │  2. runWithRequestContext() ◄────────────────────┤                 │
│   │  3. Load config                                  │                 │
│   │  4. Match route           AsyncLocalStorage      │                 │
│   │  5. Collect layouts       ┌─────────────────┐    │                 │
│   │  6. Fetch data            │ projectId       │    │                 │
│   │  7. SSR React             │ headCollector   │    │                 │
│   │  8. Inject head           │ ssrContext      │    │                 │
│   │  9. Return HTML           └─────────────────┘    │                 │
│   └────────┬─────────┘                               │                 │
│            │                                          │                 │
│            ▼                                          │                 │
│   ┌──────────────────┐                               │                 │
│   │   RESPONSE       │  ← Context disposed ──────────┘                 │
│   │   HTML + Assets  │                                                 │
│   └──────────────────┘                                                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5. Unified Adapter Interface

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     UNIFIED ADAPTER INTERFACE                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   interface UnifiedFSAdapter {                                          │
│     // Core (required)                                                  │
│     readFile(path: string): Promise<string>;                           │
│     readFileBinary(path: string): Promise<Uint8Array>;                 │
│     fileExists(path: string): Promise<boolean>;                        │
│     walkDirectory(root: string, filter?): AsyncIterable<string>;       │
│                                                                         │
│     // Metadata (optional)                                              │
│     getProjectMetadata?(): { updatedAt?: string; id?: string };        │
│   }                                                                     │
│                                                                         │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐                  │
│   │  Local FS   │   │ Veryfront   │   │   GitHub    │                  │
│   │  Adapter    │   │ API Adapter │   │   Adapter   │                  │
│   └──────┬──────┘   └──────┬──────┘   └──────┬──────┘                  │
│          │                 │                 │                          │
│          └────────────────┼─────────────────┘                          │
│                           │                                             │
│                           ▼                                             │
│                  ┌─────────────────┐                                   │
│                  │  Unified FS     │  ← Single code path               │
│                  │  Interface      │  ← No adapter conditionals        │
│                  └─────────────────┘                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6. Cache Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       CACHE ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   CONTENT-ADDRESSED (shared safely)    IDENTITY-BASED (per-project)    │
│   ════════════════════════════════    ═════════════════════════════    │
│                                                                         │
│   ┌─────────────────────┐             ┌─────────────────────┐          │
│   │  Transform Cache    │             │   Render Cache      │          │
│   │  ─────────────────  │             │  ─────────────────  │          │
│   │  key = hash(code)   │             │  key = projectId +  │          │
│   │  same code = same   │             │        path + hash  │          │
│   │  output             │             │                     │          │
│   └─────────────────────┘             └─────────────────────┘          │
│                                                                         │
│   ┌─────────────────────┐             ┌─────────────────────┐          │
│   │  HTTP Module Cache  │             │   Data Fetch Cache  │          │
│   │  ─────────────────  │             │  ─────────────────  │          │
│   │  key = URL          │             │  key = projectId +  │          │
│   │  URL is identity    │             │        endpoint     │          │
│   └─────────────────────┘             └─────────────────────┘          │
│                                                                         │
│   CACHE KEY FORMAT: v{ver}:{type}:{scope?}:{id}:{hash}                 │
│   Examples:                                                             │
│   • v18:transform:pages/index.tsx:abc123:browser                       │
│   • v18:render:proj-123:/about:def456                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 7. Timeout Hierarchy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       TIMEOUT HIERARCHY                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌─────────────────────────────────────────────────────────────────┐  │
│   │                    REQUEST TIMEOUT: 60s                         │  │
│   │  ┌─────────────────────────────────────────────────────────┐   │  │
│   │  │              RENDER PIPELINE: 45s                       │   │  │
│   │  │  ┌─────────────────────────────────────────────────┐   │   │  │
│   │  │  │           STAGE (layout/data/SSR): 30s          │   │   │  │
│   │  │  │  ┌─────────────────────────────────────────┐   │   │   │  │
│   │  │  │  │       IO (fetch/file): 15s              │   │   │   │  │
│   │  │  │  └─────────────────────────────────────────┘   │   │   │  │
│   │  │  └─────────────────────────────────────────────────┘   │   │  │
│   │  └─────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│   RULE: Each level has 15s margin for the level above it               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8. Error Propagation

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      ERROR PROPAGATION                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   BEFORE (Silent Failures)              AFTER (Explicit Handling)      │
│   ════════════════════════              ═════════════════════════      │
│                                                                         │
│   try {                                 try {                           │
│     await render();                       await render();               │
│   } catch {                             } catch (e) {                   │
│     // swallowed                          logError(e, { projectId });   │
│   }                                       throw new VeryFrontError(     │
│                                             "RENDER_FAILED",            │
│   150+ locations like this                  { cause: e }                │
│   "It just doesn't work"                  );                            │
│                                         }                               │
│                                                                         │
│   ERROR CODES: RENDER_FAILED | LAYOUT_NOT_FOUND | TRANSFORM_ERROR |    │
│                TIMEOUT | ADAPTER_ERROR | CONFIG_INVALID                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

<details>
<summary><strong>⚠️ Gotchas & Things to Watch</strong></summary>

### 🔴 Global State Patterns

```typescript
// ❌ BAD: Module-level mutable state
let cache = new Map();
export function get(key) { return cache.get(key); }

// ✅ GOOD: Project-scoped via context
export function get(key) {
  const ctx = requireRequestContext();
  return ctx.cache.get(key);
}
```

### 🔴 Regex with Global Flag

```typescript
// ❌ BAD: Global regex shares lastIndex across calls
const PATTERN = /something/g;
function extract(text) {
  return text.match(PATTERN); // lastIndex not reset!
}

// ✅ GOOD: Create new regex each call
function extract(text) {
  const pattern = /something/g;
  return text.match(pattern);
}
```

### 🔴 Lazy Singleton Race Condition

```typescript
// ❌ BAD: Multiple concurrent calls create multiple instances
let instance;
async function getInstance() {
  if (!instance) {
    instance = await createExpensive();
  }
  return instance;
}

// ✅ GOOD: Cache the promise, not the result
let instancePromise;
async function getInstance() {
  if (!instancePromise) {
    instancePromise = createExpensive();
  }
  return instancePromise;
}
```

### 🔴 Cache Keys Without Project Scope

```typescript
// ❌ BAD: Key collision across projects
const key = `layout:${path}`;

// ✅ GOOD: Include project identifier
const key = `layout:${projectId}:${path}`;
```

### 🔴 Timing-Safe Comparison

```typescript
// ❌ BAD: Vulnerable to timing attacks
if (token === expectedToken) { ... }

// ✅ GOOD: Constant-time comparison
import { timingSafeEqual } from "crypto";
if (timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) { ... }
```

### 🔴 innerHTML XSS

```typescript
// ❌ BAD: XSS vulnerability
element.innerHTML = userContent;

// ✅ GOOD: Use DOMPurify
import DOMPurify from "dompurify";
element.innerHTML = DOMPurify.sanitize(userContent);
```

### 🔴 Unbounded Maps (Memory Leak)

```typescript
// ❌ BAD: Grows forever
const cache = new Map();

// ✅ GOOD: LRU with max size
import { LRUCache } from "lru-cache";
const cache = new LRUCache({ max: 1000 });
```

</details>

---

## Success Metrics

After addressing these issues:

| Metric | Current | Target |
|--------|---------|--------|
| Adapter-specific conditionals | Many | Zero |
| Global mutable state | 15+ locations | Zero |
| Cache hit/miss behavior | Different | Identical |
| Silent error swallows | 150+ | Zero |
| "Works locally, breaks prod" bugs | Common | Eliminated |

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
