# 033 - Type Safety & Adapter Checks

## Priority: P3 - CODE QUALITY

## North Star
Remove unsafe type casts and duplicated adapter checks. Single source of truth.

## References
- Issues: [001.2-unsafe-type-casting.md](../001.2-unsafe-type-casting.md), [001.3-duplicated-isvirtualfilesystem.md](../001.3-duplicated-isvirtualfilesystem.md), [001.4-layout-cache-no-project-scope.md](../001.4-layout-cache-no-project-scope.md)

## Checklist
- [ ] Remove `as RuntimeAdapter` unsafe casts
- [ ] Remove duplicated `isVirtualFilesystem()` checks
- [ ] Add projectId to layout cache keys
- [ ] Use TypeScript discriminated unions for adapter types
- [ ] Add runtime validation at adapter boundaries

## Acceptance Criteria
- [ ] No `as RuntimeAdapter` in codebase
- [ ] Single `isVirtualFilesystem()` implementation
- [ ] Layout cache isolated per project
- [ ] Type errors caught at compile time

## Quality Gates
- [ ] `grep "as RuntimeAdapter" src/` returns 0
- [ ] Single adapter type check location
- [ ] TypeScript strict mode passes

## Test Coverage
- [ ] Unit: Type narrowing works correctly
- [ ] Unit: Layout cache includes projectId
