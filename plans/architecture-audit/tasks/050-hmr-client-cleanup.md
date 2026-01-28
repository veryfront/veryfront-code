# 050 - HMR Client Map Cleanup

## Priority: P2 - MEMORY

## North Star
HMR connections tracked and cleaned up. No memory growth from disconnected clients.

## References
- Issue: [018.1-hmr-client-map.md](../018.1-hmr-client-map.md)

## The Problem

HMR client connections stored in Map but never removed on disconnect, causing memory leak during dev.

## Checklist
- [ ] Add `close` event handler to remove clients
- [ ] Handle existing entry replacement
- [ ] Add periodic cleanup sweep
- [ ] Log client count for monitoring
- [ ] Test extended dev session

## Acceptance Criteria
- [ ] Disconnected clients removed from map
- [ ] Memory stable over long sessions
- [ ] No stale WebSocket references

## Quality Gates
- [ ] 8-hour dev session: memory stable
- [ ] Client count matches actual connections
- [ ] No GC pressure from retained objects

## Test Coverage
- [ ] Unit: Client removed on close
- [ ] Unit: Duplicate ID handled
- [ ] Integration: Memory stable over time
