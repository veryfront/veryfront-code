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

## RSS recycle containment

Production process owners can opt in to a graceful recycle after sustained RSS
pressure. The feature is disabled when `MEMORY_RECYCLE_ENABLED` is absent or
set to `false`. Other values fail startup instead of silently disabling the
policy. When enabled, set all of these values:

- `MEMORY_RECYCLE_ENABLED=true`
- `MEMORY_RECYCLE_RSS_THRESHOLD_MB=<positive-megabytes>`
- `MEMORY_RECYCLE_CONSECUTIVE_SAMPLES=<positive-integer>`
- `MEMORY_MONITORING_INTERVAL_MS=<sample-interval>` (optional, defaults to 30000)

Enabling recycle starts the existing memory monitor even when
`ENABLE_MEMORY_MONITORING` is absent or `false`. The process emits its normal
memory status and pressure logs at the selected sample interval.

The RSS threshold must leave enough memory for native allocations and for
requests that remain active during the configured shutdown drain period. The
process waits for the configured number of consecutive above-threshold samples.
A sample below the threshold resets the count, and a sustained breach initiates
one graceful shutdown.

Keep this feature disabled until a canary rollout proves the threshold and drain
margin under representative traffic. A self-initiated exit is not serialized by
a PodDisruptionBudget or Deployment surge settings. Activation therefore also
requires bounded fleet staggering and verified node and namespace headroom.
Disabling `MEMORY_RECYCLE_ENABLED` through the normal release path is the
rollback. The recycle is containment for process RSS growth, not proof that its
cause is fixed.

## Boundaries

- Rendering internals belong in [rendering runtime](./03-rendering-runtime.md).
- Production build output belongs in [build pipeline](./14-build-pipeline.md).
- Runtime adapter capability belongs in [runtime adapters](./15-runtime-adapters.md).

## Change checks

- Add handler tests for any public route behavior change.
- Keep dev-only endpoints out of production server paths.
- Keep monitoring and control-plane handlers separate from public app routes.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)
- [Middleware](../guides/middleware.md)

## Related reference

- [`veryfront/server`](../api-reference/veryfront/server.md)
- [`veryfront/middleware`](../api-reference/veryfront/middleware.md)
- [`veryfront/router`](../api-reference/veryfront/router.md)
