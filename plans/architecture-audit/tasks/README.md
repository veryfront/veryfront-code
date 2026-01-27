# Architecture Audit Tasks

## Before You Start

**[DECISIONS.md](./DECISIONS.md)** - 10 architectural decisions need sign-off before implementation.

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

---

## Execution Order

```
P0: SECURITY & FOUNDATION (do first, blocks everything)
┌─────────────────────────────────────────────────────────┐
│  001 Sandbox Config ─────────────────────────────────┐  │
│  026 Caching Strategy ◄──────────────────────────────┤  │
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
└─────────────────────────────────────────────────────────┘

P2: CACHE CORRECTNESS (can parallel with P1)
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
└─────────────────────────────────────────────────────────┘

P4: CODE CONSOLIDATION (lowest priority, do last)
┌─────────────────────────────────────────────────────────┐
│  021 Import Rewriter                                    │
│  022 HTTP Client                                        │
│  023 Timeout Centralization                             │
│  024 Error Handling                                     │
│  025 Environment Detection                              │
└─────────────────────────────────────────────────────────┘
```

## Task Index

| # | Task | Priority | Depends | Docs |
|---|------|----------|---------|------|
| [001](./001-sandbox-config-execution.md) | Sandbox Config Execution | P0 | - | [008.2](../008.2-unsafe-config-execution.md) |
| [002](./002-request-context-foundation.md) | Request Context Foundation | P0 | - | [002.0](../002.0-request-scoped-state-rfc.md) |
| [003](./003-head-collector-isolation.md) | Head Collector Isolation | P0 | 002 | [002.1](../002.1-head-collector-leakage.md) |
| [004](./004-ssr-globals-isolation.md) | SSR Globals Isolation | P0 | 002 | [002.2](../002.2-ssr-globals-context-leakage.md) |
| [005](./005-runtime-config-isolation.md) | Runtime Config Isolation | P0 | 002 | [007.7](../007.7-runtime-config-global-singleton.md) |
| [006](./006-per-project-semaphores.md) | Per-Project Semaphores | P1 | - | [009.1](../009.1-global-semaphores-no-project-isolation.md), [002.4](../002.4-semaphore-starvation.md) |
| [007](./007-failed-components-isolation.md) | Failed Components Isolation | P1 | 002 | [010.1](../010.1-failed-components-global-state.md), [002.7](../002.7-failed-components-collision.md) |
| [008](./008-react-cache-by-version.md) | React Cache by Version | P1 | - | [002.3](../002.3-react-cache-version-mismatch.md) |
| [009](./009-ai-registry-per-project.md) | AI Registry Per-Project | P1 | 002 | [002.5](../002.5-ai-registry-leakage.md) |
| [010](./010-tailwind-compiler-isolation.md) | Tailwind Compiler Isolation | P1 | - | [002.8](../002.8-tailwind-compiler-state.md) |
| [011](./011-transform-cache-deps-hash.md) | Transform Cache Deps Hash | P2 | - | [004.1](../004.1-transform-cache-no-deps-hash.md) |
| [012](./012-cache-hit-validation.md) | Cache Hit Validation | P2 | - | [003.4](../003.4-cache-hit-validation-skipped.md) |
| [013](./013-ssr-module-path-consistency.md) | SSR Module Path Consistency | P2 | - | [003.1](../003.1-ssr-module-path-mismatch.md) |
| [014](./014-config-change-invalidation.md) | Config Change Invalidation | P2 | - | [008.4](../008.4-hmr-cache-invalidation-incomplete.md), [004.6](../004.6-config-changes-not-invalidating.md) |
| [015](./015-http-bundle-ttl-fix.md) | HTTP Bundle TTL Fix | P2 | - | [003.2](../003.2-http-bundle-ttl-mismatch.md), [014.4](../014.4-cache-ttl-misclassification.md) |
| [016](./016-unified-adapter-interface.md) | Unified Adapter Interface | P3 | - | [001.0](../001.0-unified-adapter-rfc.md) |
| [017](./017-layout-discovery-unify.md) | Layout Discovery Unify | P3 | 016 | [001.1](../001.1-layout-bug-critical.md) |
| [018](./018-config-middleware-parity.md) | Config/Middleware Parity | P3 | 016 | [001.5](../001.5-config-middleware-loading-divergence.md) |
| [019](./019-css-cache-key-fix.md) | CSS Cache Key Fix | P3 | - | [001.6](../001.6-css-cache-key-divergence.md) |
| [020](./020-router-detection-cache-fix.md) | Router Detection Cache Fix | P3 | - | [005.1](../005.1-global-router-detection-cache.md) |
| [021](./021-import-rewriter-unify.md) | Import Rewriter Unify | P4 | - | [011.0](../011.0-import-rewriting-rfc.md), [011.1-5](../011.1-global-warning-state-pollution.md) |
| [022](./022-http-client-consolidate.md) | HTTP Client Consolidate | P4 | - | [012.0](../012.0-http-clients-rfc.md), [012.1-5](../012.1-missing-timeouts.md) |
| [023](./023-timeout-centralization.md) | Timeout Centralization | P4 | - | [009.0](../009.0-timeout-handling-rfc.md), [009.3](../009.3-timeout-hierarchy-violations.md), [009.5-6](../009.5-hardcoded-timeout-values.md) |
| [024](./024-error-handling-patterns.md) | Error Handling Patterns | P4 | - | [010.0](../010.0-error-handling-rfc.md), [010.3-6](../010.3-dual-veryfront-error-definitions.md) |
| [025](./025-environment-detection-unify.md) | Environment Detection | P4 | - | [006.0](../006.0-environment-detection-rfc.md), [006.1-3](../006.1-ssr-detection-inconsistencies.md) |
| [026](./026-caching-strategy.md) | Caching Strategy | P0 | - | [003.0](../003.0-cache-consistency-rfc.md), [013.1](../013.1-content-addressed-vs-identity-caching.md) |
| [027](./027-cache-key-standard.md) | Cache Key Standard | P1 | 026 | [013.0](../013.0-cache-key-patterns-rfc.md), [013.3](../013.3-key-format-standardization.md) |
| [028](./028-in-flight-deduplication.md) | In-Flight Deduplication | P1 | - | [002.6](../002.6-in-progress-deadlock.md), [009.4](../009.4-in-flight-maps-no-timeout-cleanup.md) |
| [029](./029-error-collector-isolation.md) | Error Collector Isolation | P1 | 002 | [010.2](../010.2-global-error-collector.md) |
| [030](./030-ssg-app-router-support.md) | SSG App Router Support | P2 | - | [005.2](../005.2-ssg-getallpages-missing-app-router.md), [005.5](../005.5-dynamic-route-handling-inconsistency.md) |
| [031](./031-deployment-mode-consistency.md) | Deployment Mode Consistency | P2 | - | [014.0](../014.0-deployment-modes-rfc.md), [014.1-3](../014.1-node-env-missing.md), [014.5](../014.5-header-domain-conflicts.md) |
| [032](./032-multi-tenant-test-utils.md) | Multi-Tenant Test Utils | P2 | - | [015.0](../015.0-testability-rfc.md), [015.1-5](../015.1-global-state-test-isolation.md) |
| [033](./033-type-safety-adapter-checks.md) | Type Safety & Adapter Checks | P3 | 016 | [001.2](../001.2-unsafe-type-casting.md), [001.3](../001.3-duplicated-isvirtualfilesystem.md), [001.4](../001.4-layout-cache-no-project-scope.md) |
| [034](./034-config-schema-validation.md) | Config Schema Validation | P2 | - | [007.1-6](../007.1-router-format-mismatch.md), [008.5](../008.5-config-schema-validation-gaps.md) |
| [035](./035-fetch-timeout-coverage.md) | Fetch Timeout Coverage | P1 | 023 | [009.2](../009.2-fetch-calls-without-timeout.md) |
| [036](./036-dependency-tracking-complete.md) | Dependency Tracking Complete | P2 | 011 | [004.2-5](../004.2-unused-depshash-infrastructure.md) |
| [037](./037-router-param-unification.md) | Router Param Unification | P3 | - | [005.3](../005.3-duplicated-route-params-extraction.md), [005.4](../005.4-layout-collector-router-branching.md) |
| [038](./038-agent-cache-isolation.md) | Agent Cache Isolation | P2 | 027 | [013.2](../013.2-agent-cache-project-isolation.md) |
| [039](./039-tailwind-cache-environment-scope.md) | Tailwind Cache Environment Scope | P1 | - | [002.9](../002.9-tailwind-cache-environment-scope.md) |

## Priority Definitions

| Priority | Meaning | Timeline |
|----------|---------|----------|
| **P0** | Security critical / Foundation | Week 1 |
| **P1** | Multi-tenant stability | Week 2-3 |
| **P2** | Cache correctness / Stale data | Week 3-4 |
| **P3** | Adapter parity / DX | Week 4-6 |
| **P4** | Code consolidation / Maintenance | Week 6+ |

## Quick Start

Start with these in order:
1. **001** - Sandbox config (security critical)
2. **026** - Caching strategy (defines patterns)
3. **002** - Request context (enables 003-005, 007, 009, 029)
4. **006** - Semaphores (immediate stability)
5. **035** - Fetch timeouts (no hanging requests)
6. **011** - Deps hash (stale bundles)
7. **016** - Adapter interface (enables 017-018, 033)

## Total: 38 Tasks

| Priority | Count | Focus |
|----------|-------|-------|
| P0 | 6 | Security, Foundation |
| P1 | 9 | Multi-tenant stability |
| P2 | 12 | Cache correctness, Testing |
| P3 | 6 | Adapter parity |
| P4 | 5 | Code consolidation |

## Coverage Mapping

All 15 chapters and 87 sub-documents covered:

| Chapter | Sub-Docs | Tasks |
|---------|----------|-------|
| 001 Adapter | 001.0-001.6 | 016, 017, 018, 019, 033 |
| 002 Global State | 002.0-002.8 | 002, 003, 004, 005, 006, 007, 008, 009, 010, 028 |
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

## Sub-Document to Task Map

| Doc | Task | Doc | Task | Doc | Task |
|-----|------|-----|------|-----|------|
| 001.0 | 016 | 005.4 | 037 | 010.2 | 029 |
| 001.1 | 017 | 005.5 | 030 | 010.3-6 | 024 |
| 001.2 | 033 | 006.0-3 | 025 | 011.0-5 | 021 |
| 001.3 | 033 | 007.0 | 034 | 012.0-5 | 022 |
| 001.4 | 033 | 007.1-6 | 034 | 013.0 | 027 |
| 001.5 | 018 | 007.7 | 005 | 013.1 | 026 |
| 001.6 | 019 | 008.0 | 001 | 013.2 | 038 |
| 002.0 | 002 | 008.1 | 014 | 013.3 | 027 |
| 002.1 | 003 | 008.2 | 001 | 014.0-3 | 031 |
| 002.2 | 004 | 008.3 | 014 | 014.4 | 015 |
| 002.3 | 008 | 008.4 | 014 | 014.5 | 031 |
| 002.4 | 006 | 008.5 | 034 | 015.0-5 | 032 |
| 002.5 | 009 | 009.0 | 023 | | |
| 002.6 | 028 | 009.1 | 006 | | |
| 002.7 | 007 | 009.2 | 035 | | |
| 002.8 | 010 | 009.3-6 | 023 | | |
| 003.0 | 026 | 009.4 | 028 | | |
| 003.1 | 013 | 010.0 | 024 | | |
| 003.2 | 015 | 010.1 | 007 | | |
| 003.3 | 026 | | | | |
| 003.4 | 012 | | | | |
| 004.0-1 | 011 | | | | |
| 004.2-5 | 036 | | | | |
| 004.6 | 014 | | | | |
| 005.0-1 | 020 | | | | |
| 005.2 | 030 | | | | |
| 005.3 | 037 | | | | |
