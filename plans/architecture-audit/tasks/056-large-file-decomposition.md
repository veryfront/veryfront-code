# 056 - Large File Decomposition

## Priority: P4 - CODE QUALITY

## North Star
No files over 500 lines. Clear module boundaries with single responsibilities.

## References
- Issue: [019.4-file-complexity.md](../019.4-file-complexity.md)

## The Problem

5 files exceed 1000 lines, making them hard to navigate, test, and maintain.

## Checklist
- [ ] Decide decomposition strategy (D015)
- [ ] Start with lowest-coupling file
- [ ] Extract types first (safest)
- [ ] Split by logical concern
- [ ] Maintain backward-compatible exports

## Files to Decompose

| File | Lines | Target Structure |
|------|-------|-----------------|
| `advanced-tools.ts` | 1,996 | `tools/` directory |
| `renderer.ts` | 1,200+ | `phases/` directory |
| `bundler.ts` | 1,100+ | `stages/` directory |
| `file-router.ts` | 1,050+ | `strategies/` directory |
| `loader.ts` | 1,000+ | `loaders/` directory |

## Acceptance Criteria
- [ ] No file over 500 lines
- [ ] Clear module boundaries
- [ ] Backward-compatible exports

## Quality Gates
- [ ] All tests pass
- [ ] No circular dependencies
- [ ] Import paths stable (via re-exports)

## Decision Required

**D015**: Decomposition approach
- A) All at once
- B) Incremental (one per sprint)
- C) Only when touching file
