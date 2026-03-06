# Refactoring Progress Tracker

> Tracks per-module refactoring progress across sessions.
> Last updated: 2026-03-06

## Summary
- Total modules: 54 (43 src + 11 cli)
- Completed: 0
- In progress: 0
- Skipped: 1 (cli/templates — generated content)

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
| 1 | src/fs/ | 1 | 0 | QUEUED | — | — | Pilot module |
| 2 | src/markdown/ | 1 | 0 | QUEUED | — | — | |
| 3 | src/mdx/ | 1 | 0 | QUEUED | — | — | |
| 4 | src/chat/ | 1 | 0 | QUEUED | — | — | Barrel only |
| 5 | src/sandbox/ | 2 | 0 | QUEUED | — | — | |

## Batch 2: Small Leaf Modules (2-6 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 6 | src/ai/ | 2 | 1 | QUEUED | — | — | |
| 7 | src/client/ | 3 | 1 | QUEUED | — | — | |
| 8 | src/schemas/ | 3 | 1 | QUEUED | — | — | |
| 9 | src/task/ | 4 | 2 | QUEUED | — | — | |
| 10 | src/issues/ | 5 | 2 | QUEUED | — | — | |
| 11 | src/prompt/ | 6 | 0 | QUEUED | — | — | |
| 12 | src/resource/ | 6 | 0 | QUEUED | — | — | |
| 13 | src/mcp/ | 6 | 1 | QUEUED | — | — | |

## Batch 3: Small Modules (8-10 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 14 | src/testing/ | 8 | 2 | QUEUED | — | — | |
| 15 | src/integrations/ | 8 | 3 | QUEUED | — | — | |
| 16 | src/tool/ | 9 | 0 | QUEUED | — | — | |
| 17 | src/repositories/ | 10 | 1 | QUEUED | — | — | |
| 18 | src/types/ | 10 | 1 | QUEUED | — | — | |
| 19 | src/data/ | 10 | 7 | QUEUED | — | — | |
| 20 | src/skill/ | 10 | 7 | QUEUED | — | — | |

## Batch 4: Small-Medium Modules (11-15 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 21 | src/embedding/ | 11 | 1 | QUEUED | — | — | |
| 22 | src/config/ | 11 | 8 | QUEUED | — | — | |
| 23 | src/provider/ | 14 | 1 | QUEUED | — | — | |
| 24 | src/oauth/ | 15 | 1 | QUEUED | — | — | |
| 25 | src/proxy/ | 15 | 9 | QUEUED | — | — | |

## Batch 5: Medium Modules (20-37 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 26 | src/discovery/ | 20 | 5 | QUEUED | — | — | |
| 27 | src/middleware/ | 23 | 13 | QUEUED | — | — | |
| 28 | src/studio/ | 27 | 7 | QUEUED | — | — | |
| 29 | src/errors/ | 32 | 27 | QUEUED | — | — | |
| 30 | src/react/ | 35 | 9 | QUEUED | — | — | |
| 31 | src/cache/ | 36 | 18 | QUEUED | — | — | |
| 32 | src/html/ | 37 | 27 | QUEUED | — | — | |

## Batch 6: Medium-Large Modules (39-58 files)

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 33 | src/observability/ | 39 | 21 | QUEUED | — | — | |
| 34 | src/routing/ | 43 | 32 | QUEUED | — | — | |
| 35 | src/modules/ | 49 | 26 | QUEUED | — | — | |
| 36 | src/agent/ | 55 | 11 | QUEUED | — | — | |
| 37 | src/security/ | 58 | 34 | QUEUED | — | — | |

## Batch 7: Large Modules (70-81 files) — Consider sub-batching

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 38 | src/utils/ | 70 | 42 | QUEUED | — | — | Split by subdir |
| 39 | src/workflow/ | 81 | 19 | QUEUED | — | — | Split by subdir |
| 40 | src/build/ | 81 | 31 | QUEUED | — | — | Split by subdir |

## Batch 8: XL Modules (120+ files) — Split into sub-batches

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 41 | src/rendering/ | 120 | 49 | QUEUED | — | — | Split by subdir |
| 42 | src/transforms/ | 122 | 36 | QUEUED | — | — | Split by subdir |
| 43 | src/server/ | 158 | 35 | QUEUED | — | — | Split by subdir |
| 44 | src/platform/ | 171 | 93 | QUEUED | — | — | Split by subdir |

## Batch 9: CLI Small Modules

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 45 | cli/test-utils/ | 1 | 0 | QUEUED | — | — | |
| 46 | cli/sync/ | 3 | 2 | QUEUED | — | — | |
| 47 | cli/auth/ | 6 | 6 | QUEUED | — | — | |
| 48 | cli/shared/ | 8 | 3 | QUEUED | — | — | |
| 49 | cli/utils/ | 8 | 5 | QUEUED | — | — | |
| 50 | cli/help/ | 8 | 6 | QUEUED | — | — | |
| 51 | cli/mcp/ | 15 | 13 | QUEUED | — | — | |
| 52 | cli/ui/ | 16 | 12 | QUEUED | — | — | |
| 53 | cli/app/ | 25 | 3 | QUEUED | — | — | |

## Batch 10: CLI Large

| # | Module | Files | Tests | Status | Spec PR | Refactor PR | Notes |
|---|--------|-------|-------|--------|---------|-------------|-------|
| 54 | cli/commands/ | 117 | 72 | QUEUED | — | — | Split by subdir |
| 55 | cli/templates/ | 427 | 1 | SKIPPED | — | — | Generated content |
