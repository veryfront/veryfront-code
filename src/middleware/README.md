# Middleware reference

The middleware module provides request middleware, scoped composition, response
helpers, CORS, request logging, rate limiting, and response deadlines.

For exhaustive export signatures, see the
[generated public API reference](../../docs/api-reference/veryfront/middleware.md).

## Package import

Use the public package path:

```ts
import { cors, logger, MiddlewarePipeline, rateLimit, timeout } from "veryfront/middleware";
```

The public module exports:

- `MiddlewarePipeline` and `MiddlewareContext`
- `cors` and the legacy-compatible `CorsOptions` subset
- `logger`, `devLogger`, and `prodLogger`
- `rateLimit`, `authRateLimit`, `MemoryRateLimitStore`, and `RedisRateLimitStore`
- `timeout`, `timeoutFromEnv`, and `getTimeoutFromEnv`
- The remaining public option, context, handler, and store types

Security-header, compression, and error-handler middleware are not exported from
`veryfront/middleware`.

`cors()` accepts the canonical `boolean | CORSConfig` contract. Import
`CORSConfig` from `veryfront/security` when an origin validator returns an
explicit allowed-origin string. `CorsOptions` remains available from
`veryfront/middleware` as the narrower, source-compatible contract for existing
middleware consumers.

## Pipeline execution

Use `handle()` when the pipeline wraps an application handler:

```ts
import { cors, logger, MiddlewarePipeline, rateLimit } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(logger({ format: "json" }))
  .use(cors({
    origin: ["https://example.com"],
    methods: ["GET", "POST"],
    credentials: true,
  }))
  .use(rateLimit({
    maxRequests: 100,
    windowMs: 60_000,
  }));

export function handleRequest(request: Request): Promise<Response> {
  return pipeline.handle(
    request,
    () => Response.json({ ok: true }),
  );
}
```

Use `execute()` when middleware itself produces the response. It returns a 404
response if the chain reaches its end without producing one.

```ts
import { MiddlewarePipeline } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use((context) => context.text("Hello"));

export function handleRequest(request: Request): Promise<Response> {
  return pipeline.execute(request);
}
```

## Path-scoped registrations

`useFor()` accepts a regular expression and one or more middleware handlers.
Registrations are applied in registration order.

```ts
import { type MiddlewareHandler, MiddlewarePipeline } from "veryfront/middleware";

const requireApiKey: MiddlewareHandler = (context, next) => {
  if (!context.req.headers.has("authorization")) {
    return new Response("Unauthorized", { status: 401 });
  }
  return next();
};

const pipeline = new MiddlewarePipeline()
  .useFor(/^\/api(?:\/|$)/, requireApiKey);
```

Calling `compose()` creates a snapshot. Middleware registered afterward applies
only to later compositions.

## Middleware context

`req` and `request` are synchronized aliases for the current request.

```ts
import type { MiddlewareHandler } from "veryfront/middleware";

export const addRequestState: MiddlewareHandler = async (context, next) => {
  context.set("startedAt", Date.now());
  const response = await next();
  if (!response) return response;

  response.headers.set(
    "x-started-at",
    String(context.get("startedAt")),
  );
  return response;
};
```

Response helpers accept a standard `ResponseInit`:

```ts
import { MiddlewareContext } from "veryfront/middleware";

export function createResponses(request: Request): Record<string, Response> {
  const context = new MiddlewareContext(request);
  return {
    json: context.json({ ok: true }, { status: 201 }),
    text: context.text("Created", {
      status: 201,
      headers: { "x-result": "created" },
    }),
    html: context.html("<h1>Created</h1>", { status: 201 }),
    redirect: context.redirect("/next", 303),
  };
}
```

## Logger

Logger formats are `combined`, `common`, `dev`, `short`, `tiny`, and `json`.
Use `log` to provide a custom sink.

```ts
import { logger } from "veryfront/middleware";

const messages: string[] = [];
const requestLogger = logger({
  format: "tiny",
  skip: (request) => new URL(request.url).pathname === "/healthz",
  log: (message) => messages.push(message),
});
```

## Response deadlines

`timeout()` returns a 504 response when the configured deadline elapses. It does
not cancel downstream work. Downstream code must use its own abort signal when
it needs cooperative cancellation.

```ts
import { timeout } from "veryfront/middleware";

const responseDeadline = timeout({
  timeoutMs: 30_000,
  message: "Request timeout",
  exclude: ["/healthz", "/readyz"],
});
```
