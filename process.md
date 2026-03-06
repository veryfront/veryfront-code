# Refactoring Progress Tracker

> Tracks per-module refactoring progress across sessions.
> Last updated: 2026-03-06 18:45

## Summary
- Total modules: 54 (43 src + 11 cli)
- Completed: 49 (ALL modules complete)
- In progress: 0
- Skipped: 5 (4 barrels + cli/templates)

## Status Legend
- QUEUED — Not started
- SPEC_WRITING — NLSpec being written
- SPEC_REVIEW — NLSpec PR open for human review
- SPEC_DONE — NLSpec merged
- REFACTORING — Worktree session in progress
- PR_OPEN — Refactoring PR open for review
- MERGED — Done
- SKIPPED — Intentionally skipped (reason in notes)

## Batch 1: Tiny Leaf Modules (1-2 files, 0 deps)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 1 | src/fs/ | 1 | 0 | SKIPPED | — | — | Barrel only — spec written |
| 2 | src/markdown/ | 1 | 0 | SKIPPED | — | — | Barrel only |
| 3 | src/mdx/ | 1 | 0 | SKIPPED | — | — | Barrel only |
| 4 | src/chat/ | 1 | 0 | SKIPPED | — | — | Barrel only |
| 5 | src/sandbox/ | 2 | 0 | MERGED | — | — | Pilot: extracted resolveApiUrl |

## Batch 2: Small Leaf Modules (2-6 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 6 | src/ai/ | 2 | 1 | MERGED | — | — | Fixed has() shared-registry fallback bug, added test |
| 7 | src/client/ | 3 | 1 | MERGED | — | — | Precomputed regex patterns in path-utils |
| 8 | src/schemas/ | 3 | 1 | MERGED | — | — | Spec written, code already clean |
| 9 | src/task/ | 4 | 2 | MERGED | — | — | Replaced mutate-and-delete env filtering |
| 10 | src/issues/ | 5 | 2 | MERGED | — | — | Spec written, code already clean |
| 11 | src/prompt/ | 6 | 0 | MERGED | — | — | Spec written, code already clean |
| 12 | src/resource/ | 6 | 0 | MERGED | — | — | Spec written, code already clean |
| 13 | src/mcp/ | 6 | 1 | MERGED | — | — | Spec written, code already clean |

## Batch 3: Small Modules (8-10 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 14 | src/testing/ | 8 | 2 | MERGED | — | — | Removed dead exports, simplified withTempDir/withTempFile |
| 15 | src/integrations/ | 8 | 3 | MERGED | — | — | Spec only, code already clean |
| 16 | src/tool/ | 9 | 0 | MERGED | — | — | Spec written, deduplicated schema conversion |
| 17 | src/repositories/ | 10 | 1 | MERGED | — | — | Removed dead name field, buildCacheKey, FS options schema |
| 18 | src/types/ | 10 | 1 | MERGED | — | — | Removed 4 dead exports, narrowed RouteHandler, fixed regex |
| 19 | src/data/ | 10 | 7 | MERGED | — | — | Removed unused RuntimeAdapter, simplified fetchData dispatch |
| 20 | src/skill/ | 10 | 7 | MERGED | — | — | Removed alias, simplified guard, added barrel export |

## Batch 4: Small-Medium Modules (11-15 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 21 | src/embedding/ | 11 | 1 | MERGED | — | — | Renamed mimeForType, added lookup table, fixed shadowing |
| 22 | src/config/ | 11 | 8 | MERGED | — | — | z.any()→z.unknown(), flattened validation, fixed test mock |
| 23 | src/provider/ | 14 | 1 | MERGED | — | — | Typed convertPrompt params, extracted shared options mapping |
| 24 | src/oauth/ | 15 | 1 | MERGED | — | — | Eliminated any, flattened nesting, removed redundant configs |
| 25 | src/proxy/ | 15 | 9 | MERGED | — | — | Removed dead sleep/isOTLPEnabled/span names, alias cleanup |

## Batch 5: Medium Modules (20-37 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 26 | src/discovery/ | 20 | 5 | MERGED | — | — | Removed dead fn, unsafe cast, simplified getId |
| 27 | src/middleware/ | 23 | 13 | MERGED | — | — | Spec only, code already clean |
| 28 | src/studio/ | 27 | 7 | MERGED | — | — | Removed duplicate helpers, dead constant, unused option |
| 29 | src/errors/ | 32 | 27 | MERGED | — | — | Deleted enhanced-catalog, removed duplicates, tightened types |
| 30 | src/react/ | 35 | 9 | MERGED | — | — | Deleted 8 dead files (live/ dir + redundant barrel) |
| 31 | src/cache/ | 36 | 18 | MERGED | — | — | Removed dead re-export and unused destructuring |
| 32 | src/html/ | 37 | 27 | MERGED | — | — | Removed 3 dead functions, consolidated import |

## Batch 6: Medium-Large Modules (39-58 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 33 | src/observability/ | 39 | 21 | MERGED | — | — | Removed async wrapper, per-call alloc, magic number |
| 34 | src/routing/ | 43 | 32 | MERGED | — | — | Deleted dead router.ts, filePathToPattern, deduped helper |
| 35 | src/modules/ | 49 | 26 | MERGED | — | — | Removed dead type/method, fixed any in websocket-handler |
| 36 | src/agent/ | 55 | 11 | MERGED | — | — | Removed duplicate interface, dead calls, redundant re-exports |
| 37 | src/security/ | 58 | 34 | MERGED | — | — | Removed dead re-exports, constants, deleted types.ts |

## Batch 7: Large Modules (70-81 files) — Consider sub-batching

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 38 | src/utils/ | 70 | 42 | MERGED | — | — | Deleted dead file, improved type safety, cleaned lint ignores |
| 39 | src/workflow/ | 81 | 19 | MERGED | — | — | Deleted 11 dead files, replaced 3 any with structural types |
| 40 | src/build/ | 81 | 31 | MERGED | — | — | Removed dead exports/functions, narrowed scope, simplified |

## Batch 8: XL Modules (120+ files) — Split into sub-batches

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 41 | src/rendering/ | 120 | 49 | MERGED | — | — | Interface extraction to eliminate any, dead export, cache cleanup |
| 42 | src/transforms/ | 122 | 36 | MERGED | — | — | Removed ~15 dead functions, fixed any cast |
| 43 | src/server/ | 158 | 35 | MERGED | — | — | Removed 6 dead functions, deduped proxy validation |
| 44 | src/platform/ | 171 | 93 | MERGED | — | — | Removed dead fns, eliminated 5 any casts with typed interfaces |

## Batch 9: CLI Small Modules

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 45 | cli/test-utils/ | 1 | 0 | MERGED | — | — | Spec only, already clean |
| 46 | cli/sync/ | 3 | 2 | MERGED | — | — | Added readonly types, extracted named helper |
| 47 | cli/auth/ | 6 | 6 | MERGED | — | — | Merged import, simplified ternary, canonical type |
| 48 | cli/shared/ | 8 | 3 | MERGED | — | — | Removed duplicate getApiUrl, fixed stale docs |
| 49 | cli/utils/ | 8 | 5 | MERGED | — | — | Reused cached FS, removed unreachable default |
| 50 | cli/help/ | 8 | 6 | MERGED | — | — | Eliminated duplicate computation |
| 51 | cli/mcp/ | 15 | 13 | MERGED | — | — | Removed duplicate re-export, consolidated imports |
| 52 | cli/ui/ | 16 | 12 | MERGED | — | — | Removed dead matrix animation, deduped spinner |
| 53 | cli/app/ | 25 | 3 | MERGED | — | — | Deleted dead examples view + 6 functions (-231 lines) |

## Batch 10: CLI Large

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 54 | cli/commands/ | 117 | 72 | MERGED | — | — | Fixed OAuth bug, deleted dead new/ dir, moved test |
| 55 | cli/templates/ | 427 | 1 | SKIPPED | — | — | Generated content |
