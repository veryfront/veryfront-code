# Internal rate limiter reference

This directory contains a framework-internal rate limiter. It is not exported
as `veryfront/security/rate-limit`. Application middleware is available from
`veryfront/middleware` through `rateLimit` and `authRateLimit`.

## Internal exports

| Export                  | Contract                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `createRateLimiter`     | Builds middleware with a fixed-window, sliding-window, or token-bucket strategy. |
| `RateLimitPresets`      | Provides `strict`, `moderate`, `lenient`, and `auth` configurations.             |
| `MemoryRateLimitStore`  | Stores counters and timestamps in the current process.                           |
| `fixedWindowStrategy`   | Uses the `RateLimitStore` counter interface.                                     |
| `slidingWindowStrategy` | Tracks bounded request timestamps in `MemoryRateLimitStore`.                     |
| `tokenBucketStrategy`   | Refills tokens over time in `MemoryRateLimitStore`.                              |

## Configuration

`RateLimitConfig` requires `maxRequests` and `windowMs`. Both values must be
positive safe integers.

| Field                 | Contract                                                                           |
| --------------------- | ---------------------------------------------------------------------------------- |
| `strategy`            | `fixed-window`, `sliding-window`, or `token-bucket`. Defaults to `fixed-window`.   |
| `keyGenerator`        | Returns a non-empty client key of at most 512 characters.                          |
| `skip`                | Returns whether the request bypasses limiting.                                     |
| `onRateLimitExceeded` | Builds the response for a denied request.                                          |
| `message`             | Replaces the default 429 response message.                                         |
| `store`               | Stores rate-limit state. Custom stores support fixed-window only.                  |
| `trustProxy`          | Trusts `X-Forwarded-For` and `X-Real-IP` for client identity. Defaults to `false`. |

`sliding-window` and `token-bucket` require `MemoryRateLimitStore`. The factory
rejects a custom store for either strategy instead of silently changing the
requested behavior.

## Client identity

Forwarded client-address headers are ignored unless `trustProxy` is `true`.
Enable proxy trust only when a trusted reverse proxy replaces or appends those
headers. The trusted path uses the rightmost `X-Forwarded-For` address, then
`X-Real-IP`.

Without proxy trust or a custom `keyGenerator`, the internal fallback key is
`unknown`, so all requests share one bucket. Callers that have a peer address,
authenticated principal, or API key should provide a stable key generator.
Keys are not written to rate-limit logs or trace attributes.

## Storage and lifecycle

`MemoryRateLimitStore` is process-local and is not suitable for enforcement
across multiple servers. It schedules an unreferenced cleanup timer only while
entries exist. Long-lived owners should call `destroy()` during shutdown. Tests
and short-lived owners must also dispose stores they create.

A custom fixed-window store implements:

```ts
interface RateLimitStore {
  increment(key: string, windowMs?: number): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  resetAll(): Promise<void>;
}
```

## Response behavior

Allowed responses receive `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
`X-RateLimit-Reset`. Denied requests return status 429 by default and include a
dynamic `Retry-After` value.

Store and strategy failures return status 503 with `Retry-After: 60`. The
limiter fails closed so a storage outage does not disable abuse protection.
Errors from downstream handlers and caller-provided callbacks remain visible to
the normal error handler.

## Presets

| Preset     | Limit |     Window | Strategy       |
| ---------- | ----: | ---------: | -------------- |
| `strict`   |    10 |   1 minute | Sliding window |
| `moderate` |   100 |   1 minute | Fixed window   |
| `lenient`  | 1,000 |     1 hour | Fixed window   |
| `auth`     |     5 | 15 minutes | Sliding window |

Each preset accepts a store or a `RateLimitPresetOptions` object containing a
store, key generator, and proxy-trust setting.

## Verification

```sh
deno test --no-check --allow-all \
  src/security/rate-limit/client-key.test.ts \
  src/security/rate-limit/memory-store.test.ts \
  src/security/rate-limit/middleware.test.ts \
  src/security/rate-limit/strategies.test.ts
```
