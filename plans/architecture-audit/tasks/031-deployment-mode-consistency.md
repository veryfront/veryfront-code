# 031 - Deployment Mode Consistency

## Priority: P2 - CORRECTNESS

## North Star
Combined and split deployment modes behave identically. No mode-specific bugs.

## References
- Issues: [014.1](../014.1-node-env-missing.md), [014.2](../014.2-missing-release-id.md), [014.3](../014.3-combined-split-divergence.md)
- RFC: [014.0-deployment-modes-rfc.md](../014.0-deployment-modes-rfc.md)

## Checklist
- [ ] Create `ModeResolver` service
- [ ] Consolidate environment detection (combined vs split)
- [ ] Add timeout to combined mode (match split)
- [ ] Add tracing to combined mode (match split)
- [ ] Validate NODE_ENV set on startup
- [ ] Graceful fallback when releaseId missing

## Acceptance Criteria
- [ ] Same request produces same response in combined vs split
- [ ] Errors logged identically in both modes
- [ ] Timeouts identical in both modes
- [ ] Missing releaseId handled gracefully

## Quality Gates
- [ ] Tests run in both modes
- [ ] No mode-specific code paths in business logic
- [ ] Startup validates required env vars

## Test Coverage
- [ ] Integration: Same request, combined mode
- [ ] Integration: Same request, split mode
- [ ] Integration: Compare responses match
- [ ] Unit: ModeResolver correct for each mode
