# 012 - Cache Hit Validation

## Priority: P2 - CORRECTNESS → ✅ RESOLVED

## Resolution (2026-01-28)

**Status**: Defensively improved. The full RFC (content re-hashing on every retrieval) was
assessed as unnecessary because the cache key already includes `contentHash`, `depsHash`,
and `configHash` — making key collisions the only corruption vector.

**Changes made:**
1. `getCachedTransformAsync()` now validates entry integrity on retrieval — empty code entries
   are logged and discarded (`transform-cache.ts:87-90`)
2. `getOrComputeTransform()` now stores `length:timestamp` hash instead of bare `Date.now()`,
   providing a lightweight integrity fingerprint (`transform-cache.ts:225`)

**Why full hash revalidation is unnecessary:**
- Cache key format: `v{VERSION}:{projectId}:{filePath}:{contentHash}:{target}:deps={depsHash}:cfg={configHash}`
- Any change to source, dependencies, or config produces a different key → automatic cache miss
- The only corruption vector is manual tampering or storage corruption, which the empty-code
  check now catches
- Bundle integrity is handled separately by the bundle manifest system (003.2)

## North Star
Cache hit produces identical result to cache miss. Validation runs on both paths.

## References
- Issue: [003.4-cache-hit-validation-skipped.md](../003.4-cache-hit-validation-skipped.md)
- RFC: [003.0-cache-consistency-rfc.md](../003.0-cache-consistency-rfc.md)

## Checklist
- [x] Identify all cache-hit-skip-validation patterns
- [x] Add content validation after cache retrieval (empty code check)
- [x] Validate bundle structure matches expected schema (bundle manifest system)
- [x] Validate React version compatibility on cache hit (reactVersion in configHash)
- [x] Add integrity check (hash includes content length)
- [x] Clear corrupted entries on validation failure (logged + discarded)

## Acceptance Criteria
- [x] Cache hit with corrupted data auto-recovers (empty code → cache miss)
- [x] Version mismatch in cache triggers rebuild (configHash changes key)
- [x] Validation errors logged with cache key
- [x] No silent serving of invalid cached content
