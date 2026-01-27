# 023 - Timeout Centralization

## Priority: P4 - MAINTENANCE

## North Star
Single timeout configuration. Hierarchical timeouts with clear precedence.

## References
- Issues: [009.5-hardcoded-timeout-values.md](../009.5-hardcoded-timeout-values.md), [009.6-duplicate-timeout-definitions.md](../009.6-duplicate-timeout-definitions.md), [009.3-timeout-hierarchy-violations.md](../009.3-timeout-hierarchy-violations.md)
- RFC: [009.0-timeout-handling-rfc.md](../009.0-timeout-handling-rfc.md)

## Checklist
- [ ] Create `TimeoutConfig` with hierarchy: Request > Render > Stage > IO
- [ ] Request: 60s, Render: 45s, Stage: 30s, IO: 15s
- [ ] Centralize all timeout values in config
- [ ] Remove hardcoded magic numbers (30000, 10000, etc.)
- [ ] Add deadline propagation through call stack
- [ ] Log timeout events with context

## Acceptance Criteria
- [ ] Single source of truth for all timeouts
- [ ] Inner operations timeout before outer
- [ ] No hardcoded timeout values in business logic
- [ ] Timeout configuration documented

## Quality Gates
- [ ] `grep -r "[0-9]\{4,\}" src/ | grep -i timeout` returns only config
- [ ] Hierarchy enforced: inner < outer
- [ ] All timeouts configurable via TimeoutConfig

## Test Coverage
- [ ] Unit: Hierarchy enforced (inner times out first)
- [ ] Unit: Config values used (not hardcoded)
- [ ] Integration: Request timeout cascades to stages
