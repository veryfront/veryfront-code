# Project runtime context implementation plan

## Goal

Implement candidate 5 in branch `refactor/architecture-project-runtime-context` by moving project runtime context assembly into `src/server/runtime-handler/project-runtime-context.ts` without changing public behavior.

This plan depends on `docs/plans/2026-07-24-project-runtime-context-design.md`.

## Files

Planned source changes:

- Add `src/server/runtime-handler/project-runtime-context.ts`
- Add `src/server/runtime-handler/project-runtime-context.test.ts`
- Modify `src/server/runtime-handler/index.ts`

Existing tests to keep unless a private assertion becomes duplicate:

- `src/server/runtime-handler/project-resolution.test.ts`
- `src/server/runtime-handler/adapter-factory.test.ts`
- `src/server/runtime-handler/environment-resolution.test.ts`
- `src/server/runtime-handler/handler-context-builder.test.ts`
- `src/server/runtime-handler/index.test.ts`
- `src/server/runtime-handler/project-middleware.test.ts`
- `src/server/runtime-handler/isolation.test.ts`
- `src/server/runtime-handler/request-lifecycle.test.ts`

Do not change:

- public exports
- import maps
- config schemas
- runtime adapter APIs
- source integration policy semantics
- project middleware execution semantics

## Baseline

Run the focused baseline before adding tests:

```bash
deno test --no-check --allow-all src/server/runtime-handler/project-resolution.test.ts src/server/runtime-handler/adapter-factory.test.ts src/server/runtime-handler/environment-resolution.test.ts src/server/runtime-handler/handler-context-builder.test.ts
deno test --no-check --allow-all src/server/runtime-handler/index.test.ts src/server/runtime-handler/project-middleware.test.ts src/server/runtime-handler/isolation.test.ts
```

Expected result: both commands pass on the unmodified worktree. If they fail, capture the failing tests before implementation and do not mask the failure with refactor edits.

## Red Phase

Add `src/server/runtime-handler/project-runtime-context.test.ts` first. The first run should fail because `src/server/runtime-handler/project-runtime-context.ts` does not exist yet.

Future red command after creating the test:

```bash
deno test --no-check --allow-all src/server/runtime-handler/project-runtime-context.test.ts
```

### Test Group 1: prepareProjectRequest

Cover:

- trusted proxy evidence is reused by header extraction and request-context construction.
- untrusted proxy request with `x-project-path` returns the current proxy guard error.
- missing proxy slug returns current JSON body, content type, and status `502`.
- missing proxy token returns current JSON body, content type, and status `502`.
- WebSocket `x-environment` query remains accepted while other untrusted query/header environment overrides are ignored.
- lightweight and WebSocket paths do not trigger the proxy guard.

Assertions to include:

- `proxyTrusted` is represented once in the returned trust evidence.
- returned headers match `extractRequestHeaders(req, url, proxyTrusted)`.
- returned request context matches `createRequestContext(req, { proxyTrusted })`.
- proxy guard response bodies match:
  - `{ "error": "Missing project context", "detail": "x-project-slug header is required in proxy mode" }`
  - `{ "error": "Missing authentication context", "detail": "x-token header is required in proxy mode" }`
  - `{ "error": "Untrusted proxy context", "detail": "proxy context headers require a trusted upstream proxy" }`

### Test Group 2: resolveProjectIdentity

Cover:

- forwarded host derives project slug only when trusted.
- untrusted forwarded host cannot override the host-derived project.
- explicit slug suppresses unrelated `defaultProjectId`.
- header release wins over default release and domain lookup.
- custom domain lookup preserves project slug, project ID, release, environment name, and proxy environment.
- Veryfront production domain release lookup remains unchanged when no release header exists.

Assertions to include:

- identity fields equal current `resolveProject(...)` behavior for each source.
- parsed domain object remains the same shape as the collaborator returns.
- request context mode and branch inputs pass through unchanged.

### Test Group 3: resolveProjectRuntimeContext

Cover:

- trusted `x-project-path` routes local discovery and caches the local adapter.
- untrusted `x-project-path` is not passed to local discovery.
- exact-source control-plane request keeps config undefined.
- proxy config failure rejects.
- production remote request without release returns the current 404 HTML response.
- standalone production without release falls back to configured default environment and synthetic release when applicable.
- `HandlerContext` preserves project identity, adapter, config, proxy token, environment, request context, enriched context, module server URL, and route registry.
- local projects suppress `proxyToken` in `HandlerContext`.
- env vars load only when remote plus `environmentId` plus token plus project slug.
- source integration policy is returned from the resolved config.
- skip-enriched-context behavior is preserved for API and control-plane paths.

Assertions to include:

- object references for adapter, config, route registry, and request context-sensitive data remain stable.
- returned env vars are the raw env vars for `index.ts` to filter at execution time.
- returned source policy equals `normalizeSourceIntegrationPolicy(adapterRes.config?.integrations)`.

## Green Phase

1. Add `src/server/runtime-handler/project-runtime-context.ts`.
2. Define private input/output types for the three operations.
3. Implement `prepareProjectRequest(...)` by moving the proxy trust, header extraction, request context creation, and proxy guard construction from `index.ts`.
4. Implement `resolveProjectIdentity(...)` as a thin orchestrator around `resolveProject(...)`.
5. Implement `resolveProjectRuntimeContext(...)` as a thin orchestrator around `resolveAdapter(...)`, `resolveEnvironment(...)`, `buildHandlerContext(...)`, env var cache loading, and source policy normalization.
6. Keep current response construction values in one helper inside the new Module so proxy guard parity is visible.
7. Update `index.ts` to call the three operations.
8. Keep lifecycle, monitoring, project UI, isolation, profiling, tracing, project middleware, exact-source policy execution, env overlay execution, timeout, and fallback responses in `index.ts`.
9. Run the new focused test until it passes:

```bash
deno test --no-check --allow-all src/server/runtime-handler/project-runtime-context.test.ts
```

## Refactor Phase

1. Delete duplicate request context assembly glue from `index.ts`.
2. Keep existing collaborator tests unless a private wiring assertion is now exactly duplicated by the new Module tests.
3. Confirm `index.ts` still owns observability and route execution ordering.
4. Confirm no public exports changed:

```bash
git diff -- src/server/runtime-handler/index.ts deno.json
```

5. Run focused runtime-handler tests:

```bash
deno test --no-check --allow-all src/server/runtime-handler/project-runtime-context.test.ts src/server/runtime-handler/project-resolution.test.ts src/server/runtime-handler/adapter-factory.test.ts src/server/runtime-handler/environment-resolution.test.ts src/server/runtime-handler/handler-context-builder.test.ts
deno test --no-check --allow-all src/server/runtime-handler/index.test.ts src/server/runtime-handler/project-middleware.test.ts src/server/runtime-handler/isolation.test.ts src/server/runtime-handler/request-lifecycle.test.ts
```

6. Run the broader unit command if helper contracts move:

```bash
deno test --no-check --allow-all --parallel '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

7. Run whitespace verification:

```bash
git diff --check
```

## Acceptance Criteria

- `src/server/runtime-handler/project-runtime-context.ts` exists and exposes only private runtime-handler Interfaces.
- `index.ts` no longer contains inline project request/context assembly beyond orchestration calls.
- Public exports and import maps are unchanged.
- All compatibility invariants in the design doc are protected by existing or new tests.
- Focused runtime-handler tests pass.
- The broader unit command passes, or any failure is proven unrelated and reported with evidence.
- No new dependencies.
- The main repository worktree remains untouched.

## Rollback

Rollback should be clean:

- restore `src/server/runtime-handler/index.ts`
- remove `src/server/runtime-handler/project-runtime-context.ts`
- remove `src/server/runtime-handler/project-runtime-context.test.ts`
- keep existing collaborator tests unless this branch deleted duplicate private wiring assertions

Existing collaborator tests should remain valid throughout the refactor.
