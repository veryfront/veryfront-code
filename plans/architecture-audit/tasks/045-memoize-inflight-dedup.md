# 045 - Memoize In-Flight Deduplication

## Priority: P1 - STABILITY

## North Star
Cache misses deduplicated. One expensive operation per unique key, even with concurrent requests.

## References
- Issue: [017.1-cache-stampede.md](../017.1-cache-stampede.md)
- Related: [028-in-flight-deduplication.md](./028-in-flight-deduplication.md)

## The Problem

`memoize()` doesn't deduplicate in-flight requests. N concurrent calls all execute the expensive function.

## Checklist
- [ ] Add in-flight promise tracking to `memoize()`
- [ ] Create `memoizeWithKey()` for keyed caching
- [ ] Update all memoize usages
- [ ] Add concurrent access tests
- [ ] Monitor cache efficiency

## Acceptance Criteria
- [ ] 100 concurrent calls → 1 execution
- [ ] In-flight requests share promise
- [ ] Errors don't pollute cache
- [ ] Memory cleaned up after resolution

## Quality Gates
- [ ] Concurrent test shows single execution
- [ ] Error handling works correctly
- [ ] No memory leaks from in-flight tracking

## Test Coverage
- [ ] Unit: Single execution for concurrent calls
- [ ] Unit: Cache populated after first resolves
- [ ] Unit: Error clears in-flight tracking
- [ ] Integration: Real concurrent load test

## Implementation

```typescript
export function memoize<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: T | undefined;
  let inFlight: Promise<T> | undefined;

  return async () => {
    if (cached !== undefined) return cached;
    if (inFlight !== undefined) return inFlight;

    inFlight = fn().then(result => {
      cached = result;
      inFlight = undefined;
      return result;
    }).catch(error => {
      inFlight = undefined;
      throw error;
    });

    return inFlight;
  };
}
```
