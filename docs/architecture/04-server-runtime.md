# Server runtime

This page describes server startup, route handling, and runtime server services.
It does not cover build-time route collection or production bundle generation.

## Responsibility

Server runtime code starts development and production servers, resolves request
handlers, serves runtime modules and static files, and composes rendering,
API-route, MCP, AG-UI, and monitoring handlers.

Primary source areas:

- [`src/server/`](../../src/server/)
- [`src/server/dev-server/`](../../src/server/dev-server/)
- [`src/server/handlers/`](../../src/server/handlers/)
- [`src/server/services/`](../../src/server/services/)
- [`src/routing/`](../../src/routing/)
- [`src/middleware/`](../../src/middleware/)

## Runtime flow

1. Server bootstrap loads project config and runtime environment.
2. Dev or production server code starts the runtime-specific HTTP server.
3. Request handlers classify incoming paths as static assets, modules, API
   routes, pages, MCP, AG-UI, monitoring, or dev-only endpoints.
4. Middleware and route handlers validate input, execute user code, render pages,
   or stream protocol responses.
5. Shared response helpers normalize CORS, not-found, static, and error output.

## Runtime profiles and source locality

Handler construction snapshots an immutable `development` or `production`
profile. The production registry physically omits HMR, development file/UI,
debug, metrics, memory-debug, local-project, client-log, and Markdown-preview
handlers. Route admission is therefore independent from source locality:
resolving a project from local source does not register development/control
surfaces in a production process.

The development-only forced-GC route is an operator boundary. It accepts only
the exact `POST /_debug/memory/gc` path, requires configured Basic or Bearer
authentication, shares an in-flight collection, and rate-limits new collections
to one per minute. It fails closed when operator authentication is absent.

## Shutdown contract

Production shutdown enters lame-duck mode, drains tracked request and streaming
lifetimes, and then attempts every cleanup phase allowed by listener ownership
within a shared deadline. Listener failure prevents bootstrap disposal because
request code may still reference it, but telemetry shutdown is still attempted.
Required failures and explicit timeout errors are reported afterward in one
ordered `AggregateError`; completion is logged only when no cleanup failed.
Process owners share concurrent attempts and retain a retry path after rejection,
while CLI execution maps incomplete cleanup to a nonzero exit status.

## Generated framework candidates

Development Tailwind scanning consumes a tracked framework-candidate array.
Candidate discovery is a side-effect-free, sorted, deduplicated scan of React
UI, chat, and primitive sources that excludes test/spec files. The
`generate:framework-candidates:check` task compares source with the tracked array
without writing and is part of `generate:manifests:check`. Only a genuinely
missing optional root is ignored; traversal and read failures propagate.

## Boundaries

- Rendering internals belong in [rendering runtime](./03-rendering-runtime.md).
- Production build output belongs in [build pipeline](./14-build-pipeline.md).
- Runtime adapter capability belongs in [runtime adapters](./15-runtime-adapters.md).

## Change checks

- Add handler tests for any public route behavior change.
- Keep dev-only endpoints out of the production registry, independent of
  whether application source is local.
- Keep monitoring and control-plane handlers separate from public app routes.
- Run the non-writing framework-candidate freshness check after React framework
  source changes, then regenerate once the source change is stable.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)
- [Middleware](../guides/middleware.md)

## Related reference

- [`veryfront/server`](../api-reference/veryfront/server.md)
- [`veryfront/middleware`](../api-reference/veryfront/middleware.md)
- [`veryfront/router`](../api-reference/veryfront/router.md)
