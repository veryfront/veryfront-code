# 007 - Failed Components Isolation

## Priority: P1 - ERROR LEAKAGE

## North Star
Component failure circuit breaker is project-scoped. One project's errors don't affect others.

## References
- Issues: [010.1-failed-components-global-state.md](../010.1-failed-components-global-state.md), [002.7-failed-components-collision.md](../002.7-failed-components-collision.md)
- RFC: [010.0-error-handling-rfc.md](../010.0-error-handling-rfc.md)

## Checklist
- [ ] Ensure `failedComponents` Map keys include projectId
- [ ] Replace `clearSSRModuleCache()` with project-scoped clear
- [ ] Add TTL to failed component entries (5 min default)
- [ ] Add max entries per project (prevent memory leak)
- [ ] Log when component marked as failed (with projectId)

## Acceptance Criteria
- [ ] Project A's failed component doesn't block Project B's same-path component
- [ ] `clearSSRModuleCache(projectId)` only clears that project
- [ ] Failed entries expire after TTL
- [ ] Memory bounded by max entries per project

## Quality Gates
- [ ] All `failedComponents` keys include projectId
- [ ] No global clear without projectId parameter
- [ ] Memory usage stable under repeated failures

## Test Coverage
- [ ] Unit: Same path, different projects, independent failure state
- [ ] Unit: TTL expiration clears failure
- [ ] Unit: Project-scoped clear only affects that project
- [ ] Integration: Project A failure, Project B same component succeeds
