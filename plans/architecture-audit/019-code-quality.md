# 019: Code Quality Gaps

## Overview

Code quality issues discovered during gap analysis that increase maintenance burden and bug risk.

## Risk Summary

| Category | Count | Impact |
|----------|-------|--------|
| Duplicated functions | 4+ implementations | Bug fix in one, not others |
| Large files | 5 files >1000 LOC | Hard to navigate/test |
| Naming inconsistency | 15 categories | Cognitive load |
| Cache key patterns | 30+ variants | No standardization |

## Sub-Analyses

| Doc | Issue | Scope |
|-----|-------|-------|
| [019.1](./019.1-getextension-duplication.md) | getExtension() 4x | 4 implementations |
| [019.2](./019.2-normalizepath-duplication.md) | normalizePath() 5x | 5+ implementations |
| [019.3](./019.3-cache-key-patterns.md) | Cache Key Builder 30x | 30+ patterns |
| [019.4](./019.4-file-complexity.md) | Files >1000 LOC | 5 files |
| [019.5](./019.5-naming-inconsistencies.md) | Naming Conflicts | 15 categories |

## Duplication Analysis

```
getExtension() - 4 implementations
├── src/utils/path.ts
├── src/build/transforms/common.ts
├── src/routing/file-scanner.ts
└── src/module-system/resolver.ts
→ Divergent behavior on edge cases (.tar.gz, no extension)

normalizePath() - 5+ implementations
├── src/utils/path.ts
├── src/platform/adapters/
├── src/routing/
├── src/build/
└── src/module-system/
→ Inconsistent handling of //,  \./, trailing slashes

Cache Key Builders - 30+ patterns
├── `${project}:${hash}`
├── `v1:${type}:${id}`
├── `cache:${slug}:${env}:${hash}`
├── ... 27 more variants
└── No standard format
→ Task 027 (Cache Key Standard) should consolidate
```

## Complexity Analysis

```
Files >1000 lines:
├── src/ai/tools/advanced-tools.ts    (1,996 lines)
├── src/rendering/ssr/renderer.ts     (1,200+ lines)
├── src/build/transforms/esm/bundler.ts (1,100+ lines)
├── src/routing/file-router.ts        (1,050+ lines)
└── src/module-system/loader.ts       (1,000+ lines)

Recommended splits:
├── advanced-tools.ts → tool-categories/*.ts
├── renderer.ts → phases/*.ts (hydration, streaming, error)
├── bundler.ts → stages/*.ts (parse, transform, emit)
├── file-router.ts → strategies/*.ts (app, pages)
└── loader.ts → loaders/*.ts (esm, cjs, virtual)
```

## Naming Inconsistencies

```
Handler vs Middleware vs Interceptor
├── requestHandler, routeHandler, errorHandler
├── requestMiddleware, authMiddleware
├── responseInterceptor
└── All mean similar things

ctx vs context vs requestContext
├── ctx (short form)
├── context (full form)
├── requestContext, renderContext, buildContext
├── 12+ context type variations
└── No consistent pattern

Project identifiers
├── projectId, projectSlug, slug, id
├── Sometimes interchangeable
├── Sometimes distinct meanings
└── Confusing in multi-tenant code
```

## Relationship to Existing Tasks

| Gap | Related Task | Coverage |
|-----|--------------|----------|
| getExtension | None | NEW |
| normalizePath | None | NEW |
| Cache key patterns | 027 (Cache Key Standard) | YES - but needs consolidation plan |
| File complexity | None | NEW |
| Naming | None | NEW |

## Tasks Created

| Task | Issue | Priority |
|------|-------|----------|
| [055](./tasks/055-path-utils-consolidation.md) | Consolidate path utilities | P4 |
| [056](./tasks/056-large-file-decomposition.md) | Decompose large files | P4 |
| [057](./tasks/057-naming-conventions.md) | Establish naming conventions | P4 |

## Decisions Required

- **D014**: Naming convention standard
- **D015**: Large file decomposition strategy
