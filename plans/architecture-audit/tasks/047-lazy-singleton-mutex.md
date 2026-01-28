# 047 - Lazy Singleton Mutex

## Priority: P2 - STABILITY

## North Star
Lazy singletons initialized exactly once. No duplicate instances from race conditions.

## References
- Issue: [017.3-lazy-singleton-locking.md](../017.3-lazy-singleton-locking.md)

## The Problem

Lazy initialization without mutex allows multiple concurrent calls to create duplicate instances.

## Checklist
- [ ] Audit all lazy singleton patterns
- [ ] Add mutex or promise-based locking
- [ ] Test concurrent initialization
- [ ] Document singleton pattern

## Acceptance Criteria
- [ ] Each singleton created exactly once
- [ ] Concurrent requests get same instance
- [ ] No resource leaks from duplicate instances

## Quality Gates
- [ ] Concurrent init test shows single instance
- [ ] No leaked resources
- [ ] Initialization time not significantly increased

## Test Coverage
- [ ] Unit: Single instance created
- [ ] Unit: Concurrent access returns same instance
- [ ] Unit: Error during init handled correctly
- [ ] Integration: Service singletons under load

## Implementation

```typescript
let instance: Service | null = null;
let initPromise: Promise<Service> | null = null;

export async function getService(): Promise<Service> {
  if (instance !== null) {
    return instance;
  }

  if (initPromise !== null) {
    return initPromise;
  }

  initPromise = createService().then(service => {
    instance = service;
    initPromise = null;
    return service;
  });

  return initPromise;
}
```
