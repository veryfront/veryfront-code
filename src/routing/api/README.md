# API routing internals

`src/routing/api` discovers and executes Veryfront API route files. It supports
the app-router and pages-router module shapes, resolves HTTP methods, applies
CORS, and isolates project code when runtime policy requires it.

Application authors should use the [API routes guide](../../../docs/guides/api-routes.md)
and import public types and response helpers from `veryfront`. The
`#veryfront/routing/api/*` paths described here are framework-internal and are
not published package subpaths.

## Route module shapes

### App router

An app route lives at `app/**/route.ts`, `.tsx`, `.js`, or `.jsx`. Named method
exports receive the Web `Request`; dynamic params are supplied in the second
argument.

```ts
// app/api/users/[id]/route.ts
export function GET(
  _request: Request,
  context: { params: Record<string, string> },
) {
  return Response.json({ id: context.params.id });
}
```

### Pages router

A pages route lives under `pages/api/**`. Named method exports or a callable
`default` export receive an `APIContext`.

```ts
// pages/api/users/[id].ts
import type { APIContext } from "veryfront";

export async function POST(ctx: APIContext) {
  const input = await ctx.body<{ name: string }>();
  return ctx.json({ id: ctx.params.id, name: input.name }, { status: 201 });
}
```

`APIContext` provides:

```ts
interface APIContext {
  request: Request;
  req: Request; // compatibility alias
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  headers: Headers;
  url: URL;
  json(data: unknown, init?: ResponseInit): Response;
  body<T = unknown>(): Promise<T>;
  text(data: string, init?: ResponseInit): Response;
  fs: FileSystemAdapter;
}
```

`ctx.body()` clones the request at context creation, parses JSON once, and
memoizes the result. Invalid JSON becomes a catalogued `400`. The raw
`ctx.request` remains available independently. `ctx.json` and `ctx.text`
correctly omit bodies for Fetch null-body statuses such as `204` and `304`.

## Discovery and matching

`discoverPagesRoutes` maps files below the configured `pages/api` directory to
`/api/*`, removes the extension, and treats `index` as the containing route.
`discoverAppRoutes` recursively maps only exact `route.*` files below `app/`.

`ApiRouteMatcher` exposes:

```ts
addRoute(pattern: string, page: string): void
match(path: string): RouteMatch | null
listRoutes(): Route[]
clear(): void
clearCache(): void
destroy(): void
```

Matching is specificity-based and fails closed on an equal-rank ambiguity.
Adding a route clears cached misses. Matches and route-list results are
immutable snapshots, and the public `routes` accessor returns a detached map
with detached entries. The internal match cache holds at most 500 entries and,
unless test configuration disables its timer, expires entries after five
minutes.

## HTTP method resolution

For a request method, resolution order is:

1. an own callable export with the exact normalized method name;
2. an own callable `default` export; then
3. `GET` as the conventional fallback for `HEAD`.

`OPTIONS` is framework-reachable for every matched route. A module without a
default export advertises its callable uppercase method exports, the `HEAD`
fallback when it has `GET`, and `OPTIONS`. A default export supports the
standard method surface and a bounded custom method currently being probed.
Unknown or unsupported methods produce a `405` with the canonical `Allow`
header.

## `APIRouteHandler` lifecycle

The server owns this class; application routes should not construct it.

```ts
const handler = new APIRouteHandler(projectDir, adapter, initialConfig);
await handler.initialize();

const response = await handler.handle(request, requestContext);
handler.clearCache();
handler.destroy();
```

Constructor and public lifecycle signatures:

```ts
new APIRouteHandler(
  projectDir: string,
  adapter?: RuntimeAdapter,
  initialConfig?: VeryfrontConfig,
  executionScopeId?: string,
)

initialize(): Promise<void>
handle(
  request: Request,
  ctx?: HandlerContext,
  options?: { applyCORS?: boolean },
): Promise<Response | null>
resolveRouteMethods(
  pathname: string,
  requestedMethod?: string,
  ctx?: HandlerContext,
): Promise<
  | { status: "resolved"; methods: string[] }
  | { status: "not-found" }
  | { status: "unavailable" }
>
clearCache(): void
destroy(): void
```

`handle` returns `null` for a non-API route outside this handler's ownership and
a `404` for an unmatched `/api` path. Destruction is idempotent and waits for
active requests before releasing route caches and any isolated worker scope.

## Execution and trust boundary

Remote or unknown-locality project code does not execute in the host process.
When worker isolation is required, Veryfront prepares a bounded source snapshot,
validates its dependency and remote-host policy, and executes it inside the
project-scoped worker pool. Unsupported compiled-binary or virtual-filesystem
capabilities fail closed instead of silently falling back to host evaluation.

Isolated response transfer accepts only a genuine Web `Response`, reads Web API
slots through captured platform primitives, and enforces:

| Field                 |            Limit |
| --------------------- | ---------------: |
| Body                  |           10 MiB |
| Header count          |              256 |
| Aggregate header text | 64 Ki code units |
| Status text           | 1,024 code units |

`HEAD` never consumes or transfers a body. Declared and streamed oversize
bodies are cancelled and rejected.

## CORS and response helpers

The routing barrel re-exports the canonical response helpers as `json`,
`redirect`, `notFound`, `badRequest`, `unauthorized`, `forbidden`, and
`serverError`. Application code normally imports these from `veryfront`; note
that the root package names the API-specific aliases `apiRedirect` and
`apiNotFound`.

`APIRouteHandler.handle` applies configured CORS by default. The server wrapper
sets `{ applyCORS: false }` when it needs to merge project headers and perform
one authoritative asynchronous CORS pass. Preflight handling is centralized
and does not require an application `OPTIONS` export.

## OpenAPI internals

`openapi/index.ts` is an internal framework barrel. It is not currently a
published package subpath.

`createRoute` attaches immutable OpenAPI metadata to a handler. It preserves
the handler's identity when the function is extensible and unused; frozen or
previously annotated handlers receive a callable wrapper. Configuration must
use own data properties. Summary, description, tags, response counts, status
codes, and converted JSON Schemas are bounded. Schema conversion errors are
reported instead of being replaced with a permissive placeholder.

Specification generation:

- is available only for an explicitly local project or an explicit
  host-execution capability;
- rejects malformed or OpenAPI-inexpressible route patterns;
- rejects equal route shapes and duplicate generated `operationId` values;
- snapshots data-only JSON/YAML input without invoking accessors;
- rejects cycles, unsupported values, more than 128 nesting levels, more than
  100,000 values, and encoded documents larger than 16 MiB; and
- reports the route whose module or metadata made a complete spec impossible.

Generated MCP tools:

- require an absolute HTTP(S) base URL without credentials, query, or fragment;
- preserve a configured base path;
- capture fetch, headers, deadline, and size policy at generation time;
- apply fixed headers after per-call headers so callers cannot replace
  credentials;
- reject redirects and malformed, non-JSON, invalid-UTF-8, or oversized
  responses;
- use a 30-second deadline and 4 MiB response limit by default (configurable up
  to five minutes and 16 MiB); and
- publish a generated tool set atomically if a later registration conflicts.

Ordinary downstream transport failures retain the compatibility result
`{ error: true, message }`. Caller cancellation, timeout, and boundary
violations reject so lifecycle owners can distinguish them.

## Verification

```bash
deno fmt --check src/routing/api
deno lint src/routing/api
deno check src/routing/api/index.ts
deno test -A --unstable-worker-options --trace-leaks src/routing/api
```

Changes to isolation or response transfer also require the direct security and
server consumers. Changes to OpenAPI require the request handler and MCP
registry consumers.
