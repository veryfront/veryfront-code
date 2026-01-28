# 004 - SSR Globals Context Isolation

## Priority: P0 - DATA LEAKAGE

## North Star
SSR context (domain, port, client-only flag) never leaks between projects.

## References
- Issue: [002.2-ssr-globals-context-leakage.md](../002.2-ssr-globals-context-leakage.md)
- RFC: [002.0-request-scoped-state-rfc.md](../002.0-request-scoped-state-rfc.md)
- Depends: Task 002

## Checklist
- [ ] Remove global `ssrServerPort`, `ssrProjectDomain`, `ssrClientOnlyFetching`
- [ ] Add `ssrContext` to RequestContext interface
- [ ] Update `getSSRProjectDomain()` to use context
- [ ] Update `getSSRServerPort()` to use context
- [ ] Update `isSSRClientOnlyFetching()` to use context
- [ ] Remove `setSSR*` functions (set via context instead)

## Acceptance Criteria
- [ ] API calls use correct domain per project
- [ ] Port isolation between projects
- [ ] No global `let` variables in ssr-globals/context.ts

## Quality Gates
- [ ] `grep "let ssr" src/rendering/ssr-globals/` returns nothing
- [ ] No `setSSR*` function exports
- [ ] All SSR context accessed via RequestContext

## Test Coverage
- [ ] Unit: Domain returns null outside context
- [ ] Unit: Concurrent requests get correct domains
- [ ] Integration: Project A API calls use projectA.com
- [ ] Integration: Project B API calls use projectB.com concurrently
