# 028 - In-Flight Request Deduplication

## Priority: P1 - MEMORY/STABILITY

## North Star
In-flight request tracking bounded and cleaned up. No memory leaks or deadlocks.

## References
- Issues: [002.6-in-progress-deadlock.md](../002.6-in-progress-deadlock.md), [009.4-in-flight-maps-no-timeout-cleanup.md](../009.4-in-flight-maps-no-timeout-cleanup.md)

## Checklist
- [ ] Add timeout cleanup to `globalInProgress` Map
- [ ] Add timeout cleanup to `inFlightRequests` in domain lookup
- [ ] Add max entries limit (prevent unbounded growth)
- [ ] Add periodic cleanup sweep (every 60s)
- [ ] Key by projectId + path (not just path)
- [ ] Log when entries cleaned up (debugging)

## Acceptance Criteria
- [ ] Hanging promise cleaned up after timeout
- [ ] Memory stable after repeated failures
- [ ] No cross-project deduplication collisions
- [ ] Cleanup logged for observability

## Quality Gates
- [ ] All in-flight maps have timeout cleanup
- [ ] All in-flight maps have max size
- [ ] Memory usage stable in load test

## Test Coverage
- [ ] Unit: Entry removed after timeout
- [ ] Unit: Max entries enforced
- [ ] Unit: Cleanup sweep runs
- [ ] Stress: Memory stable after 1000 requests with failures
