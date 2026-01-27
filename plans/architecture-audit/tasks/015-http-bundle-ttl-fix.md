# 015 - HTTP Bundle TTL Consistency

## Priority: P2 - CACHE STALENESS

## North Star
HTTP bundle cache TTL matches intended environment. No 36x TTL mismatch.

## References
- Issue: [003.2-http-bundle-ttl-mismatch.md](../003.2-http-bundle-ttl-mismatch.md)
- RFC: [003.0-cache-consistency-rfc.md](../003.0-cache-consistency-rfc.md)

## Checklist
- [ ] Audit TTL selection logic in http-cache.ts
- [ ] Use request-level environment, not pod-level env var
- [ ] Production: 1 hour TTL, Preview: 5 min TTL
- [ ] Add environment to cache key (prevent cross-env hits)
- [ ] Log TTL selection with reasoning

## Acceptance Criteria
- [ ] Production request on preview pod gets production TTL
- [ ] Preview request on production pod gets preview TTL
- [ ] No cross-environment cache pollution
- [ ] TTL logged per request

## Quality Gates
- [ ] TTL selection uses request context, not process.env
- [ ] Environment in HTTP cache key
- [ ] No hardcoded TTL without environment check

## Test Coverage
- [ ] Unit: Production env gets 1hr TTL
- [ ] Unit: Preview env gets 5min TTL
- [ ] Unit: TTL selection independent of pod env
- [ ] Integration: Mixed env requests on same pod
