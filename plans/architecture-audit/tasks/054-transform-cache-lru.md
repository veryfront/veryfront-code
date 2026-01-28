# 054 - Transform Cache LRU Eviction

## Priority: P2 - MEMORY

## North Star
Transform cache bounded. Old transforms evicted to maintain memory budget.

## References
- Issue: [018.5-transform-cache-eviction.md](../018.5-transform-cache-eviction.md)
- Related: [011-transform-cache-deps-hash.md](./011-transform-cache-deps-hash.md)

## The Problem

Transform results cached forever, growing unbounded with code changes and multi-tenant usage.

## Checklist
- [ ] Add LRU eviction to transform cache
- [ ] Size calculation includes source + output + map
- [ ] Consider two-tier (hot/cold) cache
- [ ] Add cache metrics
- [ ] Test memory stability

## Acceptance Criteria
- [ ] Transform cache bounded
- [ ] Eviction doesn't affect active transforms
- [ ] Memory stable over time

## Quality Gates
- [ ] Max size enforced
- [ ] Hit rate remains acceptable
- [ ] No transform failures from eviction

## Test Coverage
- [ ] Unit: Eviction at limit
- [ ] Unit: Size calculation correct
- [ ] Unit: Recently used retained
- [ ] Integration: Build performance stable

## Implementation

```typescript
const transformCache = new LRUCache<string, TransformResult>({
  max: 10000,
  maxSize: 1024 * 1024 * 1024, // 1GB
  sizeCalculation: (result) => {
    return (result.code?.length ?? 0) +
           (result.map?.length ?? 0) +
           (result.source?.length ?? 0);
  },
  ttl: 1000 * 60 * 60 * 4, // 4 hours
});
```
