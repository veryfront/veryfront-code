# 017: Race Condition Gaps

## Overview

Concurrency bugs discovered during gap analysis that are NOT covered by existing tasks 001-039.

## Risk Summary

| Pattern | Impact | Frequency |
|---------|--------|-----------|
| Cache stampede | Thundering herd | Every cache miss |
| Global regex | Corrupted extraction | Concurrent requests |
| Lazy singleton | Multiple instances | Cold start |
| Rate limit | Counter drift | High load |
| Config reload | Partial config | Hot reload |

## Sub-Analyses

| Doc | Issue | Location |
|-----|-------|----------|
| [017.1](./017.1-cache-stampede.md) | Memoize Cache Stampede | `src/utils/memoize.ts:35-51` |
| [017.2](./017.2-global-regex-state.md) | Global Regex /g State | `src/transforms/esm/http-cache.ts:620` |
| [017.3](./017.3-lazy-singleton-locking.md) | Lazy Singleton No Lock | `src/module-system/` |
| [017.4](./017.4-rate-limit-atomicity.md) | Rate Limit Counter Race | `src/middleware/rate-limit.ts` |
| [017.5](./017.5-config-reload-race.md) | Config Reload Partial Read | `src/core/config/loader.ts` |

## Impact Analysis

```
CACHE STAMPEDE (017.1)
├── 100 concurrent requests hit empty cache
├── All 100 execute expensive computation
├── Result: 100x resource usage, timeout cascade
└── Fix: In-flight deduplication (Task 028 partial)

GLOBAL REGEX (017.2)
├── BUNDLE_RE has /g flag (stateful)
├── Concurrent exec() calls share lastIndex
├── Result: Missing matches, corrupted bundles
└── Fix: New regex per call OR no /g flag

LAZY SINGLETON (017.3)
├── Await between null check and assignment
├── Two requests both see null
├── Result: Two instances created, state diverges
└── Fix: Mutex or atomic initialization

RATE LIMIT (017.4)
├── Read count, increment, compare not atomic
├── Check-then-act race window
├── Result: Limit bypassed under load
└── Fix: Atomic increment-and-compare

CONFIG RELOAD (017.5)
├── File read during partial write
├── No file locking / atomic swap
├── Result: Malformed config parsed
└── Fix: Atomic file replacement
```

## Relationship to Existing Tasks

| Gap | Related Task | Coverage |
|-----|--------------|----------|
| Cache stampede | 028 (In-Flight Dedup) | PARTIAL - covers dedup, not memoize |
| Global regex | None | NEW |
| Lazy singleton | None | NEW |
| Rate limit | None | NEW |
| Config reload | 014 (Config Invalidation) | PARTIAL - covers invalidation, not atomicity |

## Tasks Created

| Task | Issue | Priority |
|------|-------|----------|
| [045](./tasks/045-memoize-inflight-dedup.md) | Memoize in-flight deduplication | P1 |
| [046](./tasks/046-regex-state-isolation.md) | Eliminate global regex state | P1 |
| [047](./tasks/047-lazy-singleton-mutex.md) | Add mutex to lazy singletons | P2 |
| [048](./tasks/048-rate-limit-atomic.md) | Atomic rate limit counters | P2 |
| [049](./tasks/049-config-reload-atomic.md) | Atomic config file operations | P2 |
