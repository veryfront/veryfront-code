# Project runtime context design

## Outcome

Create one private deep Module for project runtime context assembly:

- `src/server/runtime-handler/project-runtime-context.ts`

The Module owns request trust evidence, project identity resolution, adapter/config/environment resolution, env var loading, source integration policy selection, and `HandlerContext` construction. `src/server/runtime-handler/index.ts` remains the runtime orchestrator for lifecycle, monitoring, scanner rejection, project UI, profiling, tracing, isolation, timeout, middleware, and route execution.

This is candidate 5 in the architecture improvement sequence. Implement it only in the isolated worktree on branch `refactor/architecture-project-runtime-context`.

## Evidence

Current ownership is split across several shallow orchestration calls in `src/server/runtime-handler/index.ts`:

- Proxy trust is evaluated near the logger context, then reused by `extractRequestHeaders`, `createRequestContext`, `resolveProject`, and `resolveAdapter`.
- Proxy guard responses for missing `x-project-slug`, missing `x-token`, and untrusted `x-project-path` are built inline before handler execution.
- Project identity resolution calls `resolveProject(...)` with request headers, request context, defaults, WebSocket slug override, and proxy trust.
- Adapter/config resolution calls `resolveAdapter(...)`, which owns local project discovery, trusted `x-project-path`, adapter cache, exact-source config skipping, proxy config loading, and proxy config failure propagation.
- Environment resolution calls `resolveEnvironment(...)`, which owns preview/production decisions, missing release responses, standalone fallback, and validation skips for WebSocket, `/_veryfront/`, and control-plane paths.
- `HandlerContext` construction calls `buildHandlerContext(...)`, preserving enriched context, `contentSourceId`, local project token suppression, and request mode normalization.
- Env var loading and source integration policy normalization happen after `HandlerContext` construction and before project middleware/route execution.

Relevant existing tests:

- `src/server/runtime-handler/project-resolution.test.ts`
- `src/server/runtime-handler/adapter-factory.test.ts`
- `src/server/runtime-handler/environment-resolution.test.ts`
- `src/server/runtime-handler/handler-context-builder.test.ts`
- `src/server/runtime-handler/index.test.ts`
- `src/server/runtime-handler/project-middleware.test.ts`
- `src/server/runtime-handler/isolation.test.ts`
- `src/server/runtime-handler/request-lifecycle.test.ts`

## Scope

In scope:

- Add a private Module with three private Interfaces:
  - `prepareProjectRequest(...)`
  - `resolveProjectIdentity(...)`
  - `resolveProjectRuntimeContext(...)`
- Move orchestration glue from `index.ts` into the new Module.
- Reuse existing modules instead of duplicating behavior.
- Preserve public exports from `src/server/runtime-handler/index.ts`.
- Preserve import map behavior and avoid new dependencies.
- Add focused regression tests before behavior-moving edits.
- Delete only duplicate private wiring assertions after the new Module tests prove parity.

Out of scope:

- No public API or public type changes.
- No changes to request lifecycle, timeout, route registry, project middleware execution, monitoring handlers, project UI rendering, tracing provider setup, or project isolation policy.
- No changes to config schema, runtime adapter APIs, domain parser behavior, env var cache semantics, or source integration policy semantics.

## Module Interface

Target shape, not existing code:

```ts
prepareProjectRequest(input): Promise<PreparedProjectRequest>
resolveProjectIdentity(input): Promise<ProjectIdentityResolution>
resolveProjectRuntimeContext(input): Promise<ProjectRuntimeContextResolution>
```

The Interface should be private to `src/server/runtime-handler/`. It should expose enough data for `index.ts` to keep lifecycle, observability, isolation, middleware, and route execution unchanged, while hiding the request context assembly order behind the Module implementation.

## Operation Boundaries

### prepareProjectRequest

Responsibilities:

- Evaluate proxy trust once per request using the same public key lookup currently used in `index.ts`.
- Extract request headers with `extractRequestHeaders(req, url, proxyTrusted)`.
- Build typed trust evidence that downstream calls must reuse.
- Build `RequestContext` through `createRequestContext(req, { proxyTrusted })`.
- Detect proxy-mode guard failures for:
  - missing `x-project-slug`
  - missing `x-token`
  - untrusted `x-project-path`
- Return logger facts and tracking facts without ending lifecycle, metrics, tracing, or isolation. `index.ts` owns those side effects.

### resolveProjectIdentity

Responsibilities:

- Call `resolveProject(...)` with prepared headers, request context, defaults, WebSocket slug override, and trust evidence.
- Preserve slug/id/release precedence:
  - request context/header slug before WebSocket slug override
  - config default before domain lookup
  - `defaultProjectId` only when no different slug overrides the default
  - header release before default release and domain release lookup
- Preserve trusted forwarded-host behavior for slug, domain, environment, and release lookup.
- Return project identity plus parsed domain and proxy environment.

### resolveProjectRuntimeContext

Responsibilities:

- Call `resolveAdapter(...)` with the resolved identity and the same trust evidence.
- Call `resolveEnvironment(...)` with current host precedence and adapter locality.
- Return early with `envRes.errorResponse` when environment validation currently returns one.
- Build `HandlerContext` with `buildHandlerContext(...)` and preserve its object shape.
- Load project env vars only for remote project requests with `environmentId`, token, and project slug.
- Normalize source integration policy from the resolved config.
- Return `HandlerContext`, adapter/config/environment data, filtered env data inputs, source integration policy, and enough identity data for `index.ts` spans and profile context.

## Collaborators

The new Module should remain deep by composing existing implementation modules:

- `project-resolution.ts` for header extraction, host parsing, custom domain lookup, and Veryfront domain release lookup.
- `adapter-factory.ts` for local/proxy adapter and config resolution.
- `environment-resolution.ts` for preview/production decisions and release validation.
- `handler-context-builder.ts` for exact `HandlerContext` construction.
- `server/context/request-context.ts` for `RequestContext`.
- Existing env var cache and project env helpers for env overlay behavior.
- Existing source integration policy helpers for policy normalization and execution boundaries.

## What Remains in index.ts

`src/server/runtime-handler/index.ts` must retain:

- `readyPromise`, security loader, registry creation, and handler factory setup.
- Monitoring-path handling with `buildMinimalContext`.
- Request lifecycle start/end and timeout behavior.
- Logger context activation using facts prepared by the new Module.
- Request tracing, request tracking, content metrics, request profiling, server timing, and response-body settlement.
- Vulnerability scanner fast rejection.
- Project UI handling through `shouldHandleProjectsUI` and `handleProjectsRequest`.
- Isolation checks and completion.
- Project middleware execution and final route registry execution.
- `runWithExactSourceIntegrationPolicy(...)` and `runWithProjectEnv(...)` execution ordering.
- RFC 9457 fallback for no handler.
- Backward-compatible exports.

## Compatibility Invariants

- Proxy trust is evaluated once and passed to all trust-sensitive paths.
- Untrusted forwarded headers fail closed exactly as today.
- `x-project-path` is honored only for trusted proxy requests.
- `x-project-path` in untrusted proxy mode produces the existing JSON error body, status `502`, and warning path.
- `x-project-slug`, `x-project-id`, `x-release-id`, `x-branch-id`, `x-branch-name`, `x-environment`, `x-environment-id`, `x-content-source-id`, `x-token`, `host`, and `x-forwarded-host` precedence remains equivalent in observable behavior.
- WebSocket `/_ws?x-environment=...` remains the only untrusted query exception for environment.
- Project slug/id/release/domain lookup behavior remains unchanged, including custom-domain lookup and Veryfront production release lookup.
- No default project ID leaks when a non-default slug is resolved.
- Local project discovery and adapter cache behavior remain unchanged.
- Exact-source control-plane requests continue to skip outer config loading.
- Proxy config loading failures continue to propagate instead of silently falling back.
- Environment resolution returns the same preview/production/release result and the same missing-release responses.
- Standalone production fallback and synthetic `standalone-dev` release behavior remain unchanged.
- `HandlerContext` fields and object identity-sensitive fields remain unchanged for handlers.
- Local projects still suppress `proxyToken` in `HandlerContext`.
- Enriched context, `contentSourceId`, request mode, module server URL, environment ID, config, adapter, parsed domain, and route registry values remain unchanged.
- Env var overlay remains active only for non-local proxy requests with a token.
- Source integration policy still wraps route execution in the same order relative to project middleware and env overlay.
- Monitoring paths, project UI, lifecycle, profiling, tracing, isolation, middleware, timeout, and scanner behavior remain outside the new Module.
- Public exports from `src/server/runtime-handler/index.ts` remain unchanged.

## Risks

- Proxy trust could be accidentally evaluated twice with different inputs. Mitigation: return typed trust evidence from `prepareProjectRequest` and pass it through every downstream call.
- `HandlerContext` object shape could drift. Mitigation: assert exact relevant fields and object references in the new Module tests.
- Env overlay or source policy ordering could change. Mitigation: keep route execution in `index.ts`; return only data needed by that orchestration.
- Monitoring and project UI could accidentally get enriched context. Mitigation: keep `buildMinimalContext` usage in `index.ts`.
- Config fallback behavior could loosen proxy failures. Mitigation: keep `resolveAdapter` as the only adapter/config implementation and add rejection tests at the new Module boundary.
