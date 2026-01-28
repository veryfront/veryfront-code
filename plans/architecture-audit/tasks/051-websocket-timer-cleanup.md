# 051 - WebSocket Timer Cleanup

## Priority: P2 - MEMORY

## North Star
All timers cleared on connection close. No timer accumulation.

## References
- Issue: [018.2-websocket-timer-cleanup.md](../018.2-websocket-timer-cleanup.md)

## The Problem

`setInterval` for heartbeats not cleared on WebSocket close, accumulating zombie timers.

## Checklist
- [ ] Track timer IDs per connection
- [ ] Add `clearInterval` on close/error
- [ ] Use AbortController pattern where appropriate
- [ ] Test timer cleanup
- [ ] Monitor active timer count

## Acceptance Criteria
- [ ] No timers running after connection closes
- [ ] AbortController cleanup pattern used
- [ ] Timer count matches connection count

## Quality Gates
- [ ] Timer count stable over time
- [ ] CPU not wasted on dead connections
- [ ] No memory leaks from timer closures

## Test Coverage
- [ ] Unit: Timer cleared on close
- [ ] Unit: Timer cleared on error
- [ ] Integration: No timer accumulation
