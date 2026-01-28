# 003 - Head Collector Isolation

## Priority: P0 - DATA LEAKAGE

## North Star
SSR metadata (title, OG tags) never leaks between projects.

## References
- Issue: [002.1-head-collector-leakage.md](../002.1-head-collector-leakage.md)
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)
- Depends: Task 002

## Checklist
- [ ] Remove global `let collected` variable
- [ ] Add `headCollector` to RequestContext interface
- [ ] Update `collectHead()` to use `getRequestContext().headCollector`
- [ ] Update `flushHeadCollector()` to use context
- [ ] Deprecate `resetHeadCollector()` (no longer needed)
- [ ] Update all SSR entry points to use context

## Acceptance Criteria
- [ ] Project A's `<title>` never appears in Project B's HTML
- [ ] OG tags isolated between concurrent requests
- [ ] No global mutable state in head-collector.ts

## Quality Gates
- [ ] `grep "let collected" src/react/head-collector.ts` returns nothing
- [ ] No `resetHeadCollector()` calls in codebase (after migration)
- [ ] Head collector tests pass with concurrent requests

## Test Coverage
- [ ] Unit: `collectHead` outside context is no-op
- [ ] Unit: Concurrent collectors don't interfere
- [ ] Integration: Two projects with different titles render correctly
- [ ] Integration: Race condition test (interleaved renders)
