# @veryfront/ext-redis

> **Category:** Distributed runtime | **Contract:** `RedisRuntimeProvider` | **Lazy**

Owns the third-party Redis clients used by Veryfront's distributed cache
facades, platform Redis adapter, and Claude Code Pub/Sub publisher. Core keeps
provider-neutral contracts and stable public APIs; Redis packages and
connection lifecycle remain inside this extension boundary.

## Installation

Install the extension alongside `veryfront` when a service uses Redis-backed
runtime features:

```sh
deno add jsr:@veryfront/veryfront npm:@veryfront/ext-redis
```

Workspace and compiled-binary builds load the first-party source package on
first Redis use. npm consumers load the separately installed extension package.
There is no in-memory fallback when a Redis feature was explicitly selected.

## Configuration

The shared client facade reads `REDIS_URL` when an explicit URL is not passed.
It also supports `REDIS_USERNAME` and `REDIS_PASSWORD`. Use `rediss://` in
production; plaintext production connections emit a warning.

The Claude Code publisher keeps its existing explicit constructor API:

```ts
import { RedisEventPublisher } from "veryfront/workflow/claude-code";

const publisher = new RedisEventPublisher({
  url: "rediss://cache.example.com:6379/0",
  channelPrefix: "claude-code",
});
```

Call `close()` on publishers and `disconnectRedisClient()` on the shared cache
client during service shutdown.

## Capabilities

- **net `*`:** connects to the configured Redis endpoint.
- **env:** reads `REDIS_URL`, `REDIS_USERNAME`, `REDIS_PASSWORD`, and
  `NODE_ENV` for connection configuration and TLS diagnostics.
