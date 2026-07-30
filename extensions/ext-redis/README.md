# @veryfront/ext-redis

Provides Redis-backed implementations for Veryfront's provider-neutral
`DistributedRuntimeProvider` contract. The package is never loaded by core,
the CLI, browser artifacts, or compiled binaries. Add and activate it
explicitly in project configuration before selecting a distributed backend.

```ts
import { defineConfig } from "veryfront";
import extRedis from "@veryfront/ext-redis";

export default defineConfig({
  extensions: [
    extRedis({ connectTimeoutMs: 5_000 }),
  ],
});
```

`connectTimeoutMs` is configured when the extension is activated and defaults
to `5000` ms.

Activating the extension registers factories only. A feature selects Redis
explicitly by selecting the provider-neutral distributed backend, for example
with `cache.render.type: "distributed"` or
`VF_CACHE_BACKEND=distributed`. `REDIS_URL` may supply connection details after
selection, but its presence never activates or selects the extension.

Missing extension registration, missing connection configuration, connection
failure, and command failure are surfaced to the caller. Core does not import
the package, discover it implicitly, or substitute an in-memory backend.

## Workflow backend lifecycle

Selecting the Redis workflow backend through the activated provider starts its
connection and consumer-group readiness immediately. The provider factory
remains synchronous, so every backend operation joins that same readiness
generation before issuing a Redis command.

Constructing `new RedisBackend(...)` directly is lazy. Await
`backend.initialize()` at startup when readiness must fail before work is
accepted, or let the first backend operation start initialization. Concurrent
operations join the current generation in either case. A failed generation is
retained and replayed to operations until an explicit `backend.initialize()`
retry succeeds.

The extension's `connectTimeoutMs` configures node-redis's native connection
timeout, and workflow connections disable automatic reconnect. Redis commands
are not wrapped in synthetic promise timeouts because a timed-out write could
still commit later. A client error invalidates the current generation and
requires explicit initialization of a fresh client.

`destroy()` permanently closes admission, cancels and joins connection or
initialization work, and closes every client owned by the backend. Concurrent
calls share one teardown. Cleanup failures are surfaced and keep teardown
retryable; the backend never silently reopens. Supplying `RedisBackend` with a
client directly transfers that dedicated client's ownership to the backend.

The provider factory transfers each workflow backend to its caller; the
extension does not close that dedicated backend during extension teardown. A
`WorkflowClient` therefore uses its default `backendOwnership: "owned"` when it
is the sole recipient. Code that intentionally shares one backend across
clients must configure each borrower with `backendOwnership: "borrowed"`, stop
all borrowers, destroy the backend once at the composition root, and only then
tear down the activated extensions. A directly constructed `RedisBackend` is
likewise owned by its creator unless ownership is explicitly transferred.

For CLI workflows, selection is explicit and provider-neutral:

```bash
veryfront workflow run publish-site --backend distributed
veryfront worker --project-dir . --entrypoint ./workflow-run.ts
```

The worker loads `veryfront.config.ts`, activates `ext-redis`, and asks the
provider for the bounded environment required by its isolated child process.
Core validates and transports that environment without interpreting Redis
configuration. The child entrypoint must also activate the project extensions
before it creates its distributed workflow backend.
