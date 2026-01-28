# 037 - Router Parameter Unification

## Priority: P3 - CODE QUALITY

## North Star
Single route parameter extraction. No duplicate implementations.

## References
- Issues: [005.3-duplicated-route-params-extraction.md](../005.3-duplicated-route-params-extraction.md), [005.4-layout-collector-router-branching.md](../005.4-layout-collector-router-branching.md)
- RFC: [005.0-router-unification-rfc.md](../005.0-router-unification-rfc.md)

## Checklist
- [ ] Merge `extractAppRouteParams` and `extractPagesRouteParams`
- [ ] Single `extractRouteParams(path, pattern)` function
- [ ] Handle both `[param]` and `:param` syntax
- [ ] Remove router branching in layout collector
- [ ] Document supported route parameter patterns

## Acceptance Criteria
- [ ] Single parameter extraction function
- [ ] Both router syntaxes supported
- [ ] ~150 lines of duplicate code removed
- [ ] Edge cases handled identically

## Quality Gates
- [ ] No duplicate param extraction functions
- [ ] Tests cover both syntaxes
- [ ] Layout collector doesn't branch on router

## Test Coverage
- [ ] Unit: `[param]` syntax
- [ ] Unit: `:param` syntax
- [ ] Unit: Catch-all `[...slug]`
- [ ] Unit: Optional catch-all `[[...slug]]`
