# 018: Memory Leak Gaps

## Overview

Memory leak patterns discovered during gap analysis that are NOT covered by existing tasks 001-039.

## Risk Summary

| Pattern | Growth Rate | Impact |
|---------|-------------|--------|
| HMR client map | Per connection | Unbounded in dev |
| WebSocket timers | Per connection | Timer accumulation |
| Event listeners | Per component | GC prevention |
| Module cache | Per unique module | Unbounded |
| Transform cache | Per transform | Unbounded |

## Sub-Analyses

| Doc | Issue | Location |
|-----|-------|----------|
| [018.1](./018.1-hmr-client-map.md) | HMR Client Map Unbounded | `src/server/hmr/` |
| [018.2](./018.2-websocket-timer-cleanup.md) | WebSocket Timer Leaks | `src/server/ws/` |
| [018.3](./018.3-event-listener-cleanup.md) | Event Listener Accumulation | Component lifecycle |
| [018.4](./018.4-module-cache-bounds.md) | Module Cache No Eviction | `src/module-system/` |
| [018.5](./018.5-transform-cache-eviction.md) | Transform Cache No Eviction | `src/build/transforms/` |

## Impact Analysis

```
HMR CLIENT MAP (018.1)
├── New entry per WebSocket connection
├── No cleanup on disconnect
├── Result: Memory grows with dev sessions
└── Fix: WeakMap or explicit cleanup

WEBSOCKET TIMERS (018.2)
├── setInterval for heartbeat
├── clearInterval not called on close
├── Result: Timers accumulate, CPU waste
└── Fix: Track timer IDs, cleanup on close

EVENT LISTENERS (018.3)
├── addEventListener without removeEventListener
├── Component unmount doesn't cleanup
├── Result: Callbacks hold references, prevent GC
└── Fix: AbortController or explicit removal

MODULE CACHE (018.4)
├── Every unique module path cached
├── No LRU eviction
├── Result: Memory grows with unique imports
└── Fix: LRU with configurable limit

TRANSFORM CACHE (018.5)
├── Every transform result cached
├── No size limit or TTL
├── Result: Memory grows unbounded
└── Fix: LRU with size/count limit
```

## Memory Growth Model

```
Development Server (8 hour session):
├── HMR reconnects: ~50 (browser refreshes)
├── Module cache entries: ~2000
├── Transform cache entries: ~500
├── Estimated leak: 50-200MB

Production (24 hour pod):
├── Module cache entries: ~10000
├── Transform cache entries: ~2000
├── Estimated leak: 100-500MB
└── Result: Pod restart required
```

## Relationship to Existing Tasks

| Gap | Related Task | Coverage |
|-----|--------------|----------|
| HMR client map | None | NEW |
| WebSocket timers | None | NEW |
| Event listeners | None | NEW |
| Module cache | 013 (SSR Module Path) | NO - path fix, not eviction |
| Transform cache | 011 (Transform Deps Hash) | NO - correctness, not eviction |

## Tasks Created

| Task | Issue | Priority |
|------|-------|----------|
| [050](./tasks/050-hmr-client-cleanup.md) | HMR client map cleanup | P2 |
| [051](./tasks/051-websocket-timer-cleanup.md) | WebSocket timer cleanup | P2 |
| [052](./tasks/052-event-listener-cleanup.md) | Event listener cleanup pattern | P3 |
| [053](./tasks/053-module-cache-lru.md) | Module cache LRU eviction | P2 |
| [054](./tasks/054-transform-cache-lru.md) | Transform cache LRU eviction | P2 |

## Decisions Required

- **D012**: Cache eviction strategy - LRU vs TTL vs hybrid
- **D013**: Cache size limits - per-cache vs global memory budget
