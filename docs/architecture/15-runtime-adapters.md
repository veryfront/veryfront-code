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
- Security checks for paths and sandbox behavior belong in dedicated security
  modules.
- A WebSocket upgrade is authorized by the normal request handler before the
  transport commits it. Node and Bun use an explicit non-DOM upgrade signal;
  Cloudflare and Deno return their runtime-native upgrade responses.
- Portable WebSocket options select at most one client-offered subprotocol and
  can add application response headers. Runtime-managed handshake headers are
  rejected. Node, Bun, and Cloudflare accept `idleTimeout: 0` as the portable
  no-timeout sentinel and reject unsupported nonzero per-connection values.
- Local runtime adapters own every server returned by `serve()`.
  `Server.stop()` unregisters that server; adapter `shutdown()` retires all
  remaining servers, shares concurrent shutdown calls, and keeps failed
  resources available for an explicit retry.
- Node validates the RFC 6455 request before registering transport state,
  preserves text and binary frame identity, and force-closes active HTTP and
  WebSocket transports during shutdown so a handler waiting on request abort
  cannot deadlock the server.
- Bun upgrades must use the original `Request` received by `Bun.serve`.
  `server.upgrade()` may invoke the native open callback synchronously, so
  consumers inspect `readyState` before waiting for `open`.
- Bun exposes filesystem watching through its Node-compatible `node:fs` API.
  Shared Node/Bun watchers own native handles, close on iterator return or
  abort, expose `ready` as the installation barrier, and expose `done` as the
  teardown barrier.

## Change checks

- Update [support matrix](./20-support-matrix.md) when runtime support changes.
- Add runtime-specific tests or compatibility tests for adapter behavior changes.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)

## Related reference

- [`veryfront/fs`](../api-reference/veryfront/fs.md)
