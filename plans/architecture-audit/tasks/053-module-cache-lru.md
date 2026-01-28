# 053 - Module Cache LRU Eviction

## Priority: P2 - MEMORY

## North Star
Module cache bounded by size/count. Memory stable over long-running processes.

## References
- Issue: [018.4-module-cache-bounds.md](../018.4-module-cache-bounds.md)
- Related: [013-ssr-module-path-consistency.md](./013-ssr-module-path-consistency.md)

## The Problem

Module cache grows without bound, eventually exhausting memory in long-running processes.

## Checklist
- [ ] Add `lru-cache` dependency
- [ ] Configure size-based eviction
- [ ] Add TTL for staleness
- [ ] Add cache metrics
- [ ] Test under sustained load

## Acceptance Criteria
- [ ] Cache size bounded
- [ ] LRU eviction working
- [ ] Memory stable over 24h+

## Quality Gates
- [ ] Max entries enforced
- [ ] Max memory enforced
- [ ] Hit rate remains acceptable (>80%)

## Test Coverage
- [ ] Unit: Eviction triggers at limit
- [ ] Unit: LRU order correct
- [ ] Unit: TTL expiry works
- [ ] Integration: Memory stable under load

## Decision Required

**D012**: Cache eviction strategy
**D013**: Cache size limits

## Implementation

```typescript
import { LRUCache } from "lru-cache";

const moduleCache = new LRUCache<string, Module>({
  max: 5000,
  maxSize: 500 * 1024 * 1024, // 500MB
  sizeCalculation: (module) => module.source.length,
  ttl: 1000 * 60 * 60, // 1 hour
});
```
