# 012 - Cache Hit Validation

## Priority: P2 - CORRECTNESS

## North Star
Cache hit produces identical result to cache miss. Validation runs on both paths.

## References
- Issue: [003.4-cache-hit-validation-skipped.md](../003.4-cache-hit-validation-skipped.md)
- RFC: [003.0-cache-consistency-rfc.md](../003.0-cache-consistency-rfc.md)

## Checklist
- [ ] Identify all cache-hit-skip-validation patterns
- [ ] Add content validation after cache retrieval
- [ ] Validate bundle structure matches expected schema
- [ ] Validate React version compatibility on cache hit
- [ ] Add integrity check (hash matches content)
- [ ] Clear corrupted entries on validation failure

## Acceptance Criteria
- [ ] Cache hit with corrupted data auto-recovers
- [ ] Version mismatch in cache triggers rebuild
- [ ] Validation errors logged with cache key
- [ ] No silent serving of invalid cached content

## Quality Gates
- [ ] All cache retrievals have validation step
- [ ] Validation errors increment metric
- [ ] Corrupted cache entries cleared automatically

## Test Coverage
- [ ] Unit: Valid cache passes validation
- [ ] Unit: Corrupted cache fails validation
- [ ] Unit: Version mismatch triggers rebuild
- [ ] Integration: Manually corrupt cache, verify recovery
- [ ] Integration: Cache with wrong React version, verify rebuild
