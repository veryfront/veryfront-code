# @veryfront/ext-redis

Veryfront extension that registers the `TokenCacheStore` contract, backed by Redis. Used by the Veryfront proxy to persist OAuth tokens across processes — the in-memory fallback works for a single-process dev server but loses tokens on restart and doesn't share across workers.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extRedis from "@veryfront/ext-redis";

export default defineConfig({
  extensions: [extRedis()],
});
```

## Environment Variables

| Variable       | Required                       | Description                                                                |
| -------------- | ------------------------------ | -------------------------------------------------------------------------- |
| `REDIS_URL`    | Yes (if explicit config unset) | Redis connection URL — e.g. `redis://localhost:6379` or `rediss://...` (TLS) |
| `REDIS_PREFIX` | No                             | Key prefix for all stored entries (default: none)                          |

Explicit config under `ctx.config.proxy.cache.redis` wins over env vars.

## Factory configuration

Configuration is read from `ctx.config.proxy.cache.redis` at setup time:

```ts
config = {
  proxy: {
    cache: {
      type: "redis",
      redis: {
        url: "redis://...",       // or REDIS_URL
        prefix: "vf:",            // or REDIS_PREFIX
        tls: true,
        username: "...",
        password: "...",
        connectTimeout: 5000,
      },
    },
  },
};
```

`url` is required; the rest are optional.

## Provided contract

`TokenCacheStore` — `get(key)`, `set(key, value, ttlMs?)`, `delete(key)`. Used by the proxy's OAuth flow to cache access and refresh tokens.

## Capabilities

- **net `*`:** Redis connection. Narrow to a specific host in your own deployment policy if you're not using a wildcard.
