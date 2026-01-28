# 022 - HTTP Client Consolidation

## Priority: P4 - MAINTENANCE

## North Star
Single HTTP client with consistent retry, timeout, and error handling.

## References
- Issues: [012.1](../012.1-missing-timeouts.md), [012.2](../012.2-retry-duplication.md), [012.5](../012.5-no-circuit-breaker.md)
- RFC: [012.0-http-clients-rfc.md](../012.0-http-clients-rfc.md)

## Checklist
- [ ] Create `HttpClient` class with middleware pattern
- [ ] Add timeout middleware (configurable, default 30s)
- [ ] Add retry middleware (exponential backoff)
- [ ] Add circuit breaker middleware
- [ ] Replace 8+ fetch wrappers with HttpClient
- [ ] Configure per-use-case (API, modules, external)

## Acceptance Criteria
- [ ] All HTTP calls have timeout
- [ ] All HTTP calls have consistent retry
- [ ] Circuit breaker prevents cascade failures
- [ ] Single HttpClient class for all uses

## Quality Gates
- [ ] No raw `fetch()` without HttpClient wrapper
- [ ] All HTTP calls have timeout configured
- [ ] Circuit breaker tested under failure conditions

## Test Coverage
- [ ] Unit: Timeout triggers after configured duration
- [ ] Unit: Retry with exponential backoff
- [ ] Unit: Circuit breaker opens after failures
- [ ] Integration: External service failure handled gracefully
