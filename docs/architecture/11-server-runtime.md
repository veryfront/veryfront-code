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

## Boundaries

- Rendering internals belong in [rendering runtime](./12-rendering-runtime.md).
- Production build output belongs in [build pipeline](./14-build-pipeline.md).
- Runtime adapter capability belongs in [runtime adapters](./13-runtime-adapters.md).

## Change checks

- Add handler tests for any public route behavior change.
- Keep dev-only endpoints out of production server paths.
- Keep monitoring and control-plane handlers separate from public app routes.
