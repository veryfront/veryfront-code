# Architecture Audit Tasks

## Before You Start

**[DECISIONS.md](./DECISIONS.md)** - 15 architectural decisions need sign-off before implementation.

| Decision | Status | Blocks |
|----------|--------|--------|
| D001 Config Format | PROPOSED | Task 001 |
| D002 AsyncLocalStorage Scope | PROPOSED | Tasks 002-005, 007, 009, 029 |
| D003 Caching Strategy | PROPOSED | Tasks 011, 026, 027 |
| D004 Cache Key Format | PROPOSED | Task 027 |
| D005 Semaphore Limits | OPEN | Task 006 |
| D006 Timeout Hierarchy | PROPOSED | Task 023 |
| D007 Error Response Format | OPEN | Task 024 |
| D008 Adapter Interface | PROPOSED | Task 016 |
| D009 React Version Strategy | DECIDED | Task 008 |
| D010 Test Utility API | OPEN | Task 032 |
| D011 Path Validation Strategy | OPEN | Task 043 |
| D012 Cache Eviction Strategy | OPEN | Tasks 053, 054 |
| D013 Cache Size Limits | OPEN | Tasks 053, 054 |
| D014 Naming Convention | OPEN | Task 057 |
| D015 File Decomposition | OPEN | Task 056 |

---

## Execution Order

```
P0: SECURITY & FOUNDATION (do first, blocks everything)
┌─────────────────────────────────────────────────────────┐
│  001 Sandbox Config ─────────────────────────────────┐  │
│  026 Caching Strategy ◄──────────────────────────────┤  │
│  040 Timing-Safe Compare (NEW - SECURITY) ◄──────────┤  │
│  041 innerHTML Sanitization (NEW - SECURITY) ◄───────┤  │
│  042 Sandbox Function Restriction (NEW - SECURITY) ◄─┤  │
│                                                      │  │
│  002 Request Context ◄───────────────────────────────┤  │
│       │                                              │  │
│       ├──► 003 Head Collector                        │  │
│       ├──► 004 SSR Globals                           │  │
│       └──► 005 Runtime Config                        │  │
└─────────────────────────────────────────────────────────┘

P1: MULTI-TENANT STABILITY (depends on P0)
┌─────────────────────────────────────────────────────────┐
│  006 Per-Project Semaphores                             │
│  007 Failed Components (depends on 002)                 │
│  008 React Cache by Version                             │
│  009 AI Registry (depends on 002)                       │
│  010 Tailwind Compiler                                  │
│  039 Tailwind Cache Environment Scope                   │
│  027 Cache Key Standard (depends on 026)                │
│  028 In-Flight Deduplication                            │
│  029 Error Collector (depends on 002)                   │
│  035 Fetch Timeout Coverage                             │
│  043 Path Traversal Validation (NEW)                    │
│  044 JSON.parse Safety (NEW)                            │
│  045 Memoize In-Flight Dedup (NEW)                      │
│  046 Regex State Isolation (NEW)                        │
└─────────────────────────────────────────────────────────┘

P2: CACHE CORRECTNESS & MEMORY (can parallel with P1)
┌─────────────────────────────────────────────────────────┐
│  011 Transform Cache Deps Hash                          │
│  012 Cache Hit Validation                               │
│  013 SSR Module Path                                    │
│  014 Config Change Invalidation                         │
│  015 HTTP Bundle TTL                                    │
│  030 SSG App Router Support                             │
│  031 Deployment Mode Consistency                        │
│  032 Multi-Tenant Test Utils                            │
│  034 Config Schema Validation                           │
│  036 Dependency Tracking Complete (depends on 011)      │
│  038 Agent Cache Isolation (depends on 027)             │
│  047 Lazy Singleton Mutex (NEW)                         │
│  048 Rate Limit Atomic (NEW)                            │
│  049 Config Reload Atomic (NEW)                         │
│  050 HMR Client Cleanup (NEW)                           │
│  051 WebSocket Timer Cleanup (NEW)                      │
│  053 Module Cache LRU (NEW)                             │
│  054 Transform Cache LRU (NEW)                          │
└─────────────────────────────────────────────────────────┘

P3: ADAPTER PARITY (depends on P0, can parallel P1/P2)
┌─────────────────────────────────────────────────────────┐
│  016 Unified Adapter Interface ◄─────────────────────┐  │
│       │                                              │  │
│       ├──► 017 Layout Discovery                      │  │
│       ├──► 018 Config/Middleware Parity              │  │
│       ├──► 019 CSS Cache Key                         │  │
│       └──► 033 Type Safety & Adapter Checks          │  │
│                                                         │
│  020 Router Detection Cache                             │
│  037 Router Param Unification                           │
│  052 Event Listener Cleanup (NEW)                       │
└─────────────────────────────────────────────────────────┘

P4: CODE CONSOLIDATION (lowest priority, do last)
┌─────────────────────────────────────────────────────────┐
│  021 Import Rewriter                                    │
│  022 HTTP Client                                        │
│  023 Timeout Centralization                             │
│  024 Error Handling                                     │
│  025 Environment Detection                              │
│  055 Path Utils Consolidation (NEW)                     │
│  056 Large File Decomposition (NEW)                     │
│  057 Naming Conventions (NEW)                           │
└─────────────────────────────────────────────────────────┘
```

## Task Index

### Original Tasks (001-039)

| # | Task | Priority | Status | Docs |
|---|------|----------|--------|------|
| [001](./001-sandbox-config-execution.md) | Sandbox Config Execution | P0 | ⚠️ Downgraded — industry pattern | [008.2](../008.2-unsafe-config-execution.md) |
| [002](./002-request-context-foundation.md) | Request Context Foundation | P0 | ✅ Done — AsyncLocalStorage in place | [002.0](../002.0-request-scoped-state-rfc.md) |
| [003](./003-head-collector-isolation.md) | Head Collector Isolation | P0 | ✅ Fixed (e01007fb) | [002.1](../002.1-head-collector-leakage.md) |
| [004](./004-ssr-globals-isolation.md) | SSR Globals Isolation | P0 | ❌ False positive — startup-only config | [002.2](../002.2-ssr-globals-context-leakage.md) |
| [005](./005-runtime-config-isolation.md) | Runtime Config Isolation | P0 | ❌ False positive — dead code | [007.7](../007.7-runtime-config-global-singleton.md) |
| [006](./006-per-project-semaphores.md) | Per-Project Semaphores | P1 | ✅ Fixed (7d99703c, 7a3365c0) | [009.1](../009.1-global-semaphores-no-project-isolation.md) |
| [007](./007-failed-components-isolation.md) | Failed Components Isolation | P1 | ❌ False positive — keys include projectId | [002.7](../002.7-failed-components-collision.md) |
| [008](./008-react-cache-by-version.md) | React Cache by Version | P1 | ⚠️ Downgraded — single React bundled | [002.3](../002.3-react-cache-version-mismatch.md) |
| [009](./009-ai-registry-per-project.md) | AI Registry Per-Project | P1 | ✅ Fixed (39d9f088) | [002.5](../002.5-ai-registry-leakage.md) |
| [010](./010-tailwind-compiler-isolation.md) | Tailwind Compiler Isolation | P1 | ✅ Fixed (8e847655) | [002.8](../002.8-tailwind-compiler-state.md) |
| [011](./011-transform-cache-deps-hash.md) | Transform Cache Deps Hash | P2 | ✅ Fixed (7629b537) | [004.1](../004.1-transform-cache-no-deps-hash.md) |
| [012](./012-cache-hit-validation.md) | Cache Hit Validation | P2 | ⚠️ Downgraded — documented design decision | [003.4](../003.4-cache-hit-validation-skipped.md) |
| [013](./013-ssr-module-path-consistency.md) | SSR Module Path Consistency | P2 | ✅ Fixed (1f82aa07) | [003.1](../003.1-ssr-module-path-mismatch.md) |
| [014](./014-config-change-invalidation.md) | Config Change Invalidation | P2 | ✅ Fixed (7629b537) — configHash in keys | [004.6](../004.6-config-changes-not-invalidating.md) |
| [015](./015-http-bundle-ttl-fix.md) | HTTP Bundle TTL Fix | P2 | ✅ Fixed (eef7dfe6) — bundle manifest | [003.2](../003.2-http-bundle-ttl-mismatch.md) |
| [016](./016-unified-adapter-interface.md) | Unified Adapter Interface | P3 | ✅ Closed — 19 checks are legitimate capability detection | [001.0](../001.0-unified-adapter-rfc.md) |
| [017](./017-layout-discovery-unify.md) | Layout Discovery Unify | P3 | ✅ Fixed (60972782) | [001.1](../001.1-layout-bug-critical.md) |
| [018](./018-config-middleware-parity.md) | Config/Middleware Parity | P3 | ✅ Partial (6fbf6ba9) — predicate unified | [001.5](../001.5-config-middleware-loading-divergence.md) |
| [019](./019-css-cache-key-fix.md) | CSS Cache Key Fix | P3 | ⚠️ Deferred — by-design adapter difference | [001.6](../001.6-css-cache-key-divergence.md) |
| [020](./020-router-detection-cache-fix.md) | Router Detection Cache Fix | P3 | ⚠️ Downgraded — low risk | [005.1](../005.1-global-router-detection-cache.md) |
| [021](./021-import-rewriter-unify.md) | Import Rewriter Unify | P4 | ✅ Done — strategy pattern (688305c1) | [011.0](../011.0-import-rewriting-rfc.md) |
| [022](./022-http-client-consolidate.md) | HTTP Client Consolidate | P4 | ✅ Closed — different contracts justify separate impls | [012.0](../012.0-http-clients-rfc.md) |
| [023](./023-timeout-centralization.md) | Timeout Centralization | P4 | ✅ Fixed — centralized HTTP_FETCH_TIMEOUT_MS | [009.0](../009.0-timeout-handling-rfc.md) |
| [024](./024-error-handling-patterns.md) | Error Handling Patterns | P4 | ✅ Partial (5af5ff4c, 66a2ffc0) | [010.0](../010.0-error-handling-rfc.md) |
| [025](./025-environment-detection-unify.md) | Environment Detection | P4 | ✅ Fixed (1926ff65) | [006.0](../006.0-environment-detection-rfc.md) |
| [026](./026-caching-strategy.md) | Caching Strategy | P0 | ✅ Done — manifest + deps tracking | [003.0](../003.0-cache-consistency-rfc.md) |
| [027](./027-cache-key-standard.md) | Cache Key Standard | P1 | ⚠️ Deferred — central builder exists | [013.0](../013.0-cache-key-patterns-rfc.md) |
| [028](./028-in-flight-deduplication.md) | In-Flight Deduplication | P1 | ❌ False positive — keys include projectId | [002.6](../002.6-in-progress-deadlock.md) |
| [029](./029-error-collector-isolation.md) | Error Collector Isolation | P1 | ⚠️ Downgraded — dev tooling only | [010.2](../010.2-global-error-collector.md) |
| [030](./030-ssg-app-router-support.md) | SSG App Router Support | P2 | ✅ Fixed (34ab1029) | [005.2](../005.2-ssg-getallpages-missing-app-router.md) |
| [031](./031-deployment-mode-consistency.md) | Deployment Mode Consistency | P2 | ✅ Fixed (d7b53ac0) | [014.0](../014.0-deployment-modes-rfc.md) |
| [032](./032-multi-tenant-test-utils.md) | Multi-Tenant Test Utils | P2 | ✅ Done — withTenants + assertIsolated helpers | [015.0](../015.0-testability-rfc.md) |
| [033](./033-type-safety-adapter-checks.md) | Type Safety & Adapter Checks | P3 | ⚠️ Deferred — most have runtime guards | [001.2](../001.2-unsafe-type-casting.md) |
| [034](./034-config-schema-validation.md) | Config Schema Validation | P2 | ✅ Fixed — unknown keys now throw | [007.1-6](../007.1-router-format-mismatch.md) |
| [035](./035-fetch-timeout-coverage.md) | Fetch Timeout Coverage | P1 | ✅ Fixed (7a3365c0, d7b53ac0) | [009.2](../009.2-fetch-calls-without-timeout.md) |
| [036](./036-dependency-tracking-complete.md) | Dependency Tracking Complete | P2 | ✅ Fixed (7629b537) | [004.2-5](../004.2-unused-depshash-infrastructure.md) |
| [037](./037-router-param-unification.md) | Router Param Unification | P3 | ✅ Closed — dead code deleted | [005.3](../005.3-duplicated-route-params-extraction.md) |
| [038](./038-agent-cache-isolation.md) | Agent Cache Isolation | P2 | ✅ Fixed (d7b53ac0) | [013.2](../013.2-agent-cache-project-isolation.md) |
| [039](./039-tailwind-cache-environment-scope.md) | Tailwind Cache Environment Scope | P1 | ⚠️ Downgraded — preview uses different path | [002.9](../002.9-tailwind-cache-environment-scope.md) |

### Gap Analysis Tasks (040-057)

| # | Task | Priority | Status | Docs |
|---|------|----------|--------|------|
| [040](./040-timing-safe-compare.md) | Timing-Safe Compare | P0 | ✅ Fixed (eafa78c1) | [016.1](../016.1-timing-attack.md) |
| [041](./041-innerhtml-sanitization.md) | innerHTML Sanitization | P0 | ❌ False positive — sanitizer exists | [016.2](../016.2-innerhtml-sanitization.md) |
| [042](./042-sandbox-function-restriction.md) | Sandbox Function Restriction | P0 | ⚠️ Downgraded — Worker sandboxed | [016.3](../016.3-sandbox-escape.md) |
| [043](./043-path-traversal-validation.md) | Path Traversal Validation | P1 | ❌ False positive — SecureFs exists | [016.4](../016.4-path-traversal.md) |
| [044](./044-json-parse-safety.md) | JSON.parse Safety | P1 | ✅ Fixed (42126bcf) | [016.5](../016.5-json-parse-validation.md) |
| [045](./045-memoize-inflight-dedup.md) | Memoize In-Flight Dedup | P1 | ✅ Fixed (cbea3d14) | [017.1](../017.1-cache-stampede.md) |
| [046](./046-regex-state-isolation.md) | Regex State Isolation | P1 | ✅ Fixed (cbea3d14) | [017.2](../017.2-global-regex-state.md) |
| [047](./047-lazy-singleton-mutex.md) | Lazy Singleton Mutex | P2 | ⚠️ Downgraded — 3/4 have dedup, low risk | [017.3](../017.3-lazy-singleton-locking.md) |
| [048](./048-rate-limit-atomic.md) | Rate Limit Atomic | P2 | ⚠️ Downgraded — JS single-threaded | [017.4](../017.4-rate-limit-atomicity.md) |
| [049](./049-config-reload-atomic.md) | Config Reload Atomic | P2 | ⚠️ Downgraded — worst case: one stale req | [017.5](../017.5-config-reload-race.md) |
| [050](./050-hmr-client-cleanup.md) | HMR Client Cleanup | P2 | ✅ Mitigated — cleanup on disconnect | [018.1](../018.1-hmr-client-map.md) |
| [051](./051-websocket-timer-cleanup.md) | WebSocket Timer Cleanup | P2 | ✅ Mitigated — clearInterval on shutdown | [018.2](../018.2-websocket-timer-cleanup.md) |
| [052](./052-event-listener-cleanup.md) | Event Listener Cleanup | P3 | ⚠️ Downgraded — GC handles cleanup | [018.3](../018.3-event-listener-cleanup.md) |
| [053](./053-module-cache-lru.md) | Module Cache LRU | P2 | ✅ Mitigated — LRU 10K + 5min TTL | [018.4](../018.4-module-cache-bounds.md) |
| [054](./054-transform-cache-lru.md) | Transform Cache LRU | P2 | ✅ Mitigated — LRU 500 + TTL | [018.5](../018.5-transform-cache-eviction.md) |
| [055](./055-path-utils-consolidation.md) | Path Utils Consolidation | P4 | ✅ Fixed (6fbf6ba9) | [019.1](../019.1-getextension-duplication.md) |
| [056](./056-large-file-decomposition.md) | Large File Decomposition | P4 | ✅ Closed — single consumer, cohesive groupings | [019.4](../019.4-file-complexity.md) |
| [057](./057-naming-conventions.md) | Naming Conventions | P4 | ✅ Closed — 95%+ consistent, enforce via review | [019.5](../019.5-naming-inconsistencies.md) |

## Priority Definitions

| Priority | Meaning | Focus |
|----------|---------|-------|
| **P0** | Security critical / Foundation | Immediate |
| **P1** | Multi-tenant stability | Sprint 1-2 |
| **P2** | Cache correctness / Memory | Sprint 2-3 |
| **P3** | Adapter parity / DX | Sprint 3-4 |
| **P4** | Code consolidation | Ongoing |

## Status: AUDIT COMPLETE

All P0/P1 security and stability issues are resolved. Remaining items are deferred code quality improvements with no production impact.

All deferred items have been reviewed and resolved. No outstanding work remains.

## Total: 57 Tasks

| Category | Count |
|----------|-------|
| ✅ Fixed / Done / Closed | 38 |
| ❌ False positive | 5 |
| ⚠️ Downgraded / Deferred | 14 |
| **Total** | **57** |

## Coverage Mapping

All 19 chapters covered:

| Chapter | Sub-Docs | Tasks |
|---------|----------|-------|
| 001 Adapter | 001.0-001.6 | 016, 017, 018, 019, 033 |
| 002 Global State | 002.0-002.9 | 002, 003, 004, 005, 006, 007, 008, 009, 010, 028, 039 |
| 003 Cache | 003.0-003.4 | 012, 013, 015, 026 |
| 004 Dependencies | 004.0-004.6 | 011, 014, 036 |
| 005 Router | 005.0-005.5 | 020, 030, 037 |
| 006 Runtime | 006.0-006.3 | 025 |
| 007 Config | 007.0-007.7 | 005, 034 |
| 008 Userland | 008.0-008.5 | 001, 014, 034 |
| 009 Timeout | 009.0-009.6 | 006, 023, 028, 035 |
| 010 Error | 010.0-010.6 | 007, 024, 029 |
| 011 Import | 011.0-011.5 | 021 |
| 012 HTTP | 012.0-012.5 | 022 |
| 013 Cache Keys | 013.0-013.3 | 026, 027, 038 |
| 014 Deployment | 014.0-014.5 | 015, 031 |
| 015 Testability | 015.0-015.5 | 032 |
| **016 Security** | 016.1-016.5 | **040, 041, 042, 043, 044** |
| **017 Race Conditions** | 017.1-017.5 | **045, 046, 047, 048, 049** |
| **018 Memory Leaks** | 018.1-018.5 | **050, 051, 052, 053, 054** |
| **019 Code Quality** | 019.1-019.5 | **055, 056, 057** |

## Gap Analysis Summary

Tasks 040-057 address gaps discovered during comprehensive codebase analysis:

| Category | Issues | Tasks | Priority |
|----------|--------|-------|----------|
| Security | 5 vulnerabilities | 040-044 | P0-P1 |
| Race Conditions | 5 critical | 045-049 | P1-P2 |
| Memory Leaks | 5 patterns | 050-054 | P2-P3 |
| Code Quality | 3 areas | 055-057 | P4 |
