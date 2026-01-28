# 006 - Per-Project Semaphore Fairness

## Priority: P1 - STABILITY

## North Star
One slow project cannot exhaust shared resources and block all other projects.

## References
- Issues: [009.1-global-semaphores-no-project-isolation.md](../009.1-global-semaphores-no-project-isolation.md), [002.4-semaphore-starvation.md](../002.4-semaphore-starvation.md)
- RFC: [009.0-timeout-handling-rfc.md](../009.0-timeout-handling-rfc.md)

## Checklist
- [ ] Create `FairSemaphore` class with per-project limits
- [ ] Replace `renderSemaphore` (30 global → 10 per project, 30 global)
- [ ] Replace `transformSemaphore` (20 global → 5 per project, 20 global)
- [ ] Replace `apiSemaphore` (50 global → 15 per project, 50 global)
- [ ] Add timeout to semaphore acquisition (30s default)
- [ ] Add metrics for semaphore wait times per project

## Acceptance Criteria
- [ ] Project A's 30 slow renders don't block Project B
- [ ] Global limit still prevents system overload
- [ ] Semaphore acquisition has timeout (not infinite wait)
- [ ] Metrics show per-project utilization

## Quality Gates
- [ ] No single project can acquire >50% of global permits
- [ ] All semaphore acquisitions have timeout
- [ ] Load test: heavy project doesn't starve light project

## Test Coverage
- [ ] Unit: Per-project limit enforced
- [ ] Unit: Global limit still enforced
- [ ] Unit: Timeout triggers after configured duration
- [ ] Integration: Concurrent heavy/light project load test
- [ ] Stress: 100 requests from one project, verify others served
