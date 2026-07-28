# Legacy source-local rate limiter

This directory is not a published `veryfront/security/rate-limit` entrypoint.
The supported public rate limiter is owned by
[`veryfront/middleware`](../../middleware/README.md):

```typescript
import {
  authRateLimit,
  MemoryRateLimitStore,
  rateLimit,
} from "veryfront/middleware";
```

The middleware implementation validates its configuration, bounds its
in-memory identity store, computes `Retry-After` from the actual reset time,
fails closed on store errors, and supports the framework middleware lifecycle.

## Current source-local contents

| File | Status |
| --- | --- |
| `client-key.ts` | Shared production helper used by the public middleware limiter |
| `middleware.ts` | Legacy source-local API with no production consumer |
| `memory-store.ts` | Legacy process-local store |
| `strategies.ts` | Legacy fixed-window, sliding-window, and token-bucket strategies |
| `types.ts` and `index.ts` | Legacy deep-import contracts |

The legacy implementation is retained only while deep-import compatibility is
being resolved. It must not be used for new code or documented as a package
subpath.

## Behavioral differences

- Store/strategy failures return `503` and do not call downstream code.
- Sliding-window and token-bucket strategies fall back to fixed-window behavior
  for custom stores.
- The legacy in-memory store has no distributed coordination and no bounded
  identity capacity.
- Preset and response-header behavior differs from the maintained middleware
  implementation.

These differences are why the two implementations must not be treated as
interchangeable.

## Migration

| Legacy source-local API | Supported middleware API |
| --- | --- |
| `createRateLimiter(config)` | `rateLimit(options)` |
| `RateLimitPresets.auth(...)` | `authRateLimit(...)` |
| `MemoryRateLimitStore()` | `MemoryRateLimitStore(windowMs, options)` |

The middleware callback contract uses the framework `Middleware` context rather
than the legacy `(request, next)` function shape. Migrate at the middleware
registration boundary instead of adding an adapter that perpetuates both
lifecycles.
