# 035 - Fetch Timeout Coverage

## Priority: P1 - STABILITY

## North Star
Every fetch call has a timeout. No indefinite hangs.

## References
- Issue: [009.2-fetch-calls-without-timeout.md](../009.2-fetch-calls-without-timeout.md)
- RFC: [009.0-timeout-handling-rfc.md](../009.0-timeout-handling-rfc.md)

## Locations to Fix
1. Domain lookup fetch
2. Module server fetch
3. Tailwind compiler fetch
4. ESM rewriter fetch
5. OAuth provider fetch (3 calls)
6. External API fetches

## Checklist
- [ ] Audit all `fetch()` calls in codebase
- [ ] Add AbortController with timeout to each
- [ ] Use standard timeout from TimeoutConfig
- [ ] Add timeout metric for observability
- [ ] Handle AbortError gracefully

## Acceptance Criteria
- [ ] Every fetch has AbortController
- [ ] Timeout triggers after configured duration
- [ ] Graceful error message on timeout
- [ ] Timeout events logged

## Quality Gates
- [ ] `grep -r "fetch(" src/ | grep -v AbortController` returns 0
- [ ] All fetches use standard timeout helper
- [ ] Timeout duration from config (not hardcoded)

## Test Coverage
- [ ] Unit: Fetch times out after duration
- [ ] Unit: AbortError handled gracefully
- [ ] Integration: Slow external service times out
