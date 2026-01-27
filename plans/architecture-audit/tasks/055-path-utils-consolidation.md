# 055 - Path Utilities Consolidation

## Priority: P4 - CODE QUALITY

## North Star
Single source of truth for path operations. Consistent behavior across codebase.

## References
- Issue: [019.1-getextension-duplication.md](../019.1-getextension-duplication.md)
- Issue: [019.2-normalizepath-duplication.md](../019.2-normalizepath-duplication.md)

## The Problem

`getExtension()` and `normalizePath()` have 4-5 different implementations with subtly different behavior.

## Checklist
- [ ] Audit all path utility implementations
- [ ] Design unified API with options
- [ ] Create comprehensive test suite
- [ ] Migrate one module at a time
- [ ] Remove duplicate implementations

## Acceptance Criteria
- [ ] Single `getExtension()` implementation
- [ ] Single `normalizePath()` implementation
- [ ] All edge cases handled consistently

## Quality Gates
- [ ] All existing tests pass
- [ ] Edge cases documented and tested
- [ ] No behavior regressions

## Test Coverage
- [ ] Unit: All extension edge cases
- [ ] Unit: All path normalization edge cases
- [ ] Integration: File routing still works
- [ ] Integration: Module resolution still works

## Implementation

```typescript
// src/utils/path.ts

export function getExtension(path: string, options?: {
  compound?: boolean;
  specialExtensions?: string[];
}): string;

export function normalizePath(path: string, options?: {
  dedupeSlashes?: boolean;
  removeTrailingSlash?: boolean;
  removeLeadingDotSlash?: boolean;
  resolveRelative?: boolean;
}): string;
```
