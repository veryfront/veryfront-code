# @veryfront/ext-cache-redis

> **Category:** Storage | **Contract:** `TokenCacheStore` | **Optional**

Provides Redis-backed token-cache persistence for Veryfront. The proxy uses it
to share OAuth tokens across processes. Explicit Redis selection is fail-closed:
startup and operations surface missing configuration or service failures.

## Installation

Add the extension to your project's `veryfront.config.ts`:

```ts
import extRedis from "@veryfront/ext-cache-redis";

export default defineConfig({
  extensions: [extRedis()],
});
```

## Environment Variables

| Variable         | Required                       | Description                                                                                         |
| ---------------- | ------------------------------ | --------------------------------------------------------------------------------------------------- |
| `REDIS_URL`      | Yes (if explicit config unset) | Redis connection URL — e.g. `redis://localhost:6379` or `rediss://...` (TLS)                        |
| `REDIS_PREFIX`   | No                             | Token-key prefix (default: `vf:token:`)                                                             |
| `REDIS_PASSWORD` | No                             | Password override when credentials are not embedded in the connection URL                           |
| `CACHE_TYPE`     | Standalone proxy only          | Set to `extension` so the CLI activates this extension before importing the provider-neutral proxy |

Explicit config under `ctx.config.proxy.cache.redis` wins over env vars.

## Factory configuration

Configuration is read from `ctx.config.proxy.cache.redis` at setup time:

```ts
config = {
  proxy: {
    cache: {
      type: "redis",
      redis: {
        url: "redis://...", // or REDIS_URL
        prefix: "vf:", // or REDIS_PREFIX
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

For the standalone CLI proxy, select and configure the extension before
startup:

```bash
CACHE_TYPE=extension \
REDIS_URL=redis://localhost:6379 \
veryfront serve --mode=proxy
```

The CLI activates `@veryfront/ext-cache-redis` through the extension loader
before it imports the proxy runtime. Missing packages, missing Redis
configuration, or a missing `TokenCacheStore` contract stop startup. The
loader retains ownership of the store; the proxy borrows it and does not close
it independently. `REDIS_PREFIX` in this path must contain at most 256 visible
ASCII characters and cannot contain Redis glob metacharacters (`*`, `?`, `[`,
`]`, or `\`).

## Provided contract

`TokenCacheStore` — `get(key)`, `set(key, entry)`, `delete(key)`, `clear()`,
`has(key)`, `stats()`, and `close()`. Entry expiry is carried in
`entry.expiresAt`. The proxy uses the contract for OAuth service-token caching.

## Capabilities

- **net `*`:** Redis connection. Narrow to a specific host in your own deployment policy if you're not using a wildcard.
- **env:** reads `REDIS_URL`, `REDIS_PREFIX`, and `REDIS_PASSWORD` when explicit
  config is not set.
