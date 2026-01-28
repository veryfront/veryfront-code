# 048 - Atomic Rate Limit Counters

## Priority: P2 - STABILITY

## North Star
Rate limits enforced correctly under high concurrency. No bypass through race conditions.

## References
- Issue: [017.4-rate-limit-atomicity.md](../017.4-rate-limit-atomicity.md)

## The Problem

Rate limit check-then-increment is not atomic, allowing limit bypass under concurrent load.

## Checklist
- [ ] Implement atomic increment-and-check
- [ ] For single-node: use mutex pattern
- [ ] For multi-node: use Redis INCR
- [ ] Add concurrent rate limit test
- [ ] Monitor actual vs expected limits

## Acceptance Criteria
- [ ] Limit enforced exactly (not exceeded)
- [ ] No bypass under concurrent load
- [ ] Performance acceptable (< 5ms overhead)

## Quality Gates
- [ ] 1000 concurrent requests, only N allowed
- [ ] No limit exceeded in testing
- [ ] Response time within SLA

## Test Coverage
- [ ] Unit: Sequential requests limited correctly
- [ ] Unit: Concurrent requests limited correctly
- [ ] Unit: Window expiry works
- [ ] Integration: Load test with limits

## Implementation

```typescript
// Single-node with mutex
async function checkRateLimit(key: string, limit: number): Promise<boolean> {
  const release = await mutex.acquire();
  try {
    const count = counters.get(key) ?? 0;
    if (count >= limit) return false;
    counters.set(key, count + 1);
    return true;
  } finally {
    release();
  }
}

// Multi-node with Redis
async function checkRateLimit(key: string, limit: number): Promise<boolean> {
  const count = await redis.incr(`ratelimit:${key}`);
  if (count === 1) {
    await redis.expire(`ratelimit:${key}`, windowSeconds);
  }
  return count <= limit;
}
```
