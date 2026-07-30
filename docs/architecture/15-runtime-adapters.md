# Runtime adapters

This page describes runtime adapter capability boundaries. It does not cover
deployment targets or build output generation.

## Responsibility

Runtime adapters normalize Deno, Node.js, Bun, and constrained edge runtime
capabilities behind shared server, filesystem, and environment access patterns.

Primary source areas:

- [`src/platform/`](../../src/platform/)
- [`src/platform/adapters/`](../../src/platform/adapters/)
- [`src/platform/cloud/`](../../src/platform/cloud/)
- [`src/fs/`](../../src/fs/)
- [`src/server/project-env/`](../../src/server/project-env/)

## Runtime flow

1. Runtime detection selects an adapter for the current host.
2. Adapter code exposes HTTP serving, filesystem, environment, and process
   capabilities in a shared shape.
3. Virtual filesystem adapters can replace or augment local file access.
4. Project environment helpers resolve framework and project variables.

## Boundaries

- Runtime adapter support is separate from deployment product support.
- Build pipeline code can target a runtime, but adapters own runtime capability
  normalization.
- Automatic registry construction is limited to Deno, Node.js, and Bun.
  Cloudflare requires request-scoped bindings and explicit adapter
  construction. Unknown or overlapping host signals are classified
  deterministically and unsupported initialization fails explicitly.
- Registry get, set, and reset operations are ordered. Concurrent reads share
  initialization, replacement initializes before publication, and superseded
  adapters are shut down once.
- Security checks for paths and sandbox behavior belong in dedicated security
  modules.
- Local filesystem `exists()` returns false only for a recognized missing path;
  invalid paths and operational errors propagate. Temporary-directory prefixes
  are filename fragments and reject path separators or null bytes before
  reaching a native API.
- Cloudflare environment adapters snapshot own string bindings at construction
  and place later writes in an adapter-local overlay. Inherited values,
  non-string resources, and request mutations never become deployment binding
  mutations.
- The remote filesystem factory creates only Veryfront and GitHub adapters.
  Local files remain owned by the runtime adapter, while unsupported backend
  discriminators fail explicitly rather than falling back to local storage.
- Hosted and GitHub caches include source authority in their identity. GitHub
  entries are repository and ref scoped; hosted reads are project and source
  snapshot scoped. In-flight work is deduplicated only when the full operation
  identity agrees.
- A WebSocket upgrade is authorized by the normal request handler before the
  transport commits it. Node and Bun use an explicit non-DOM upgrade signal;
  Cloudflare and Deno return their runtime-native upgrade responses.
- Portable WebSocket options select at most one client-offered subprotocol.
  Node, Bun, and Cloudflare can add application response headers; Deno's native
  upgrade API cannot, so its adapter rejects them instead of silently dropping
  them. Runtime-managed handshake headers are rejected. Node, Bun, and
  Cloudflare accept `idleTimeout: 0` as the portable no-timeout sentinel and
  reject unsupported nonzero per-connection values. Deno supports any
  non-negative finite timeout accepted by its native per-connection API.
- Local runtime adapters own every server returned by `serve()`.
  `Server.stop()` unregisters that server; adapter `shutdown()` retires all
  remaining servers, shares concurrent shutdown calls, and keeps failed
  resources available for an explicit retry.
- Node validates the RFC 6455 request before registering transport state,
  preserves text and binary frame identity, and force-closes active HTTP and
  WebSocket transports during shutdown so a handler waiting on request abort
  cannot deadlock the server.
- The public compatibility `HttpServer` uses `onListen` as its portable
  readiness boundary and `close()` as its portable shutdown barrier. Its Node
  facade delegates to the canonical runtime transport, which reports the native
  ephemeral address, preserves distinct cookies, applies response backpressure,
  propagates client disconnect through the Fetch signal, and gives concurrent
  close calls one retryable teardown.
- The public server `toNodeHandler()` compatibility entry point delegates to
  that same canonical Node request listener instead of maintaining a second
  Fetch bridge. Incoming disconnects abort `Request.signal`, response writes
  respect Node backpressure, distinct cookies remain distinct, and streaming
  failures destroy an already-committed response rather than writing new
  headers.
- Node keeps its raw HTTP listener error route after readiness only when
  `ServeOptions.onRuntimeError` is present. Each post-readiness raw server
  `error` event reaches that callback once; callback exceptions and rejected
  promises are contained and logged so they cannot escape the EventEmitter
  boundary. Omitting the callback preserves Node's fail-fast default, and
  successful shutdown detaches the route. Startup errors retain their identity
  when cleanup succeeds; if cleanup also fails, rejection is an
  `AggregateError` containing both failures. The compatibility `DenoHttpServer`
  reports listener lifetime failure through its `serve()` rejection only,
  avoiding duplicate runtime reports.
- Node 18 can finish a queued native lookup after an earlier `close()` reports
  completion. Startup cancellation therefore replaces application-bearing
  callbacks with shared one-shot guards until that attempt emits `listening` or
  `error`; a late listener is immediately closed and a late bind error is
  contained. Newer Node releases can cancel the lookup without emitting either
  outcome. Their closed server may retain the two shared guards, but no active
  handle or application closure; the unreachable cycle is garbage-collectable
  because Node exposes no public cancellation acknowledgement.
- The composable Node service server acquires that Platform startup owner before
  publishing its handle and aborts it during pre-readiness stop. Consequently,
  service startup, adapter startup, and compatibility startup use the same late
  listener retirement and retryable transport teardown instead of parallel
  ownership state machines.
- Deno rejects already-aborted starts before binding, reports the native bound
  address for ephemeral ports, and owns an internal abort signal even when a
  caller supplies one. This keeps direct stop, adapter shutdown, and startup
  cleanup retryable without mutating the caller's signal.
- Bun upgrades must use the original `Request` received by `Bun.serve`.
  `server.upgrade()` may invoke the native open callback synchronously, so
  consumers inspect `readyState` before waiting for `open`.
- Bun exposes filesystem watching through its Node-compatible `node:fs` API.
  Shared Node/Bun watchers own native handles, close on iterator return or
  abort, expose `ready` as the installation barrier, and expose `done` as the
  teardown barrier. `ready` rejects if any requested root cannot be acquired.
  Native runtime failure closes the watcher generation and rejects `done`.
- Deno uses `Deno.watchFs` rather than polling snapshots. Native event paths are
  mapped back to the caller-visible watch roots, concurrent iterator reads fail
  explicitly, and `ready`/`done` provide installation and teardown barriers.

## Change checks

- Update [support matrix](./20-support-matrix.md) when runtime support changes.
- Add runtime-specific tests or compatibility tests for adapter behavior changes.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)

## Related reference

- [`veryfront/fs`](../api-reference/veryfront/fs.md)
