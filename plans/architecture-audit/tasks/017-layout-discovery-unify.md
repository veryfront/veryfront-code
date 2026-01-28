# 017 - Layout Discovery Unification

## Priority: P3 - CRITICAL BUG

## North Star
Layout discovery works identically across all adapters. No "works locally, breaks in production".

## References
- Issue: [001.1-layout-bug-critical.md](../001.1-layout-bug-critical.md)
- RFC: [001.0-unified-adapter-rfc.md](../001.0-unified-adapter-rfc.md)
- Depends: Task 016

## Checklist
- [ ] Create `discoverLayouts(adapter, pagePath, config)` function
- [ ] Remove `isVeryfrontAdapter` branch in layout-collector.ts
- [ ] Use `adapter.walkDirectory()` for all adapters
- [ ] Handle both App Router and Pages Router layouts
- [ ] Collect nested layouts in correct order (root → leaf)
- [ ] Add layout discovery cache with adapter+path key

## Acceptance Criteria
- [ ] Nested App Router layouts work with Veryfront API adapter
- [ ] Same page renders identically via Local vs API adapter
- [ ] Layout order consistent (root first, leaf last)
- [ ] No layout discovery code paths branch on adapter type

## Quality Gates
- [ ] Single `discoverLayouts` function, no adapter branches
- [ ] Layout discovery tests pass for all adapters
- [ ] Production App Router projects have working nested layouts

## Test Coverage
- [ ] Unit: Discover single layout
- [ ] Unit: Discover nested layouts (3 levels)
- [ ] Unit: App Router layout.tsx discovery
- [ ] Conformance: Same layout structure via all adapters
- [ ] Integration: Render nested layout page via API adapter
