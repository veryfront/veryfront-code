---
title: "Middleware"
description: "CORS, rate limiting, logging, and custom middleware pipelines."
order: 15
---

Middleware runs before your route handler. Use it for CORS headers, rate limits, logging, timeouts, and auth checks. A `MiddlewarePipeline` chains middleware together and short-circuits to a `Response` when one rejects the request.

The pipeline works in both router styles. The route module wrapper changes:

- App router API routes live at `app/api/**/route.ts` and export named HTTP method handlers such as `GET` or `POST`. The handler receives the `Request` directly.
- Pages router API routes live at `pages/api/**` and export named HTTP method handlers or a `default` fallback handler. The handler receives an `APIContext` as `ctx`; use `ctx.request` when a middleware expects a `Request`.

## Prerequisites

- At least one API route in your project (see [API routes](./api-routes.md)).
- The dev server running so you can hit the routes with `curl`.

## Built-in middleware

### CORS

```ts
import { cors } from "veryfront/middleware";

const corsMiddleware = cors({
  origin: "https://example.com", // or "*" or ["https://a.com", "https://b.com"]
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  maxAge: 86400,
});
```

### Rate limiting

```ts
import { rateLimit } from "veryfront/middleware";

const limiter = rateLimit({
  maxRequests: 100, // Max requests per window
  windowMs: 60_000, // 1 minute window
  trustProxy: true, // Only behind a trusted reverse proxy
});
```

Forwarded client-address headers are ignored by default. If the app is not
behind a trusted reverse proxy, use `keyGenerator` with a trusted client or
account identifier.

Use Redis when multiple runtime processes must share counters:

```ts
import { rateLimit, RedisRateLimitStore } from "veryfront/middleware";

const redisUrl = Deno.env.get("REDIS_URL");
if (!redisUrl) throw new Error("REDIS_URL is required");

const rateLimitStore = new RedisRateLimitStore({
  url: redisUrl,
  connectTimeoutMs: 5_000,
  operationTimeoutMs: 5_000,
});

export const limiter = rateLimit({
  maxRequests: 100,
  windowMs: 60_000,
  store: rateLimitStore,
});

export async function stopRateLimitStore(): Promise<void> {
  await rateLimitStore.destroy();
}
```

### Logging

```ts
import { logger } from "veryfront/middleware";

const log = logger({ format: "combined" });
```

Supported formats are `combined`, `common`, `dev`, `short`, `tiny`, and
`json`.

### Timeout

```ts
import { timeout } from "veryfront/middleware";

const timer = timeout({ timeoutMs: 30_000 }); // 30 seconds
```

## Pipeline composition

Combine middleware into a pipeline:

```ts
import { cors, logger, MiddlewarePipeline, rateLimit, timeout } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(cors({ origin: "*" }))
  .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }))
  .use(logger({ format: "short" }))
  .use(timeout({ timeoutMs: 30_000 }));
```

### Route-specific middleware

Apply middleware only to matching URL patterns:

```ts
import { cors, MiddlewarePipeline, rateLimit, timeout } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(cors({ origin: "*" }))
  .useFor(/^\/api\//, rateLimit({ maxRequests: 50, windowMs: 60_000 }))
  .useFor(/^\/api\/chat\//, timeout({ timeoutMs: 120_000 }));
```

### Run middleware around a route

```ts
// app/api/users/route.ts
import { MiddlewarePipeline, rateLimit } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }));

const users = [{ id: "user_123", name: "Ada Lovelace" }];

export function GET(request: Request): Promise<Response> {
  return pipeline.handle(request, () => Response.json(users));
}
```

The same pattern works in a pages router handler. Pass `ctx.request` to the
pipeline and return the route response from the final handler:

```ts
// pages/api/users.ts
import type { APIContext } from "veryfront";
import { MiddlewarePipeline, rateLimit } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }));

const users = [{ id: "user_123", name: "Ada Lovelace" }];

export function GET(ctx: APIContext): Promise<Response> {
  return pipeline.handle(ctx.request, () => ctx.json(users));
}
```

Try it with the dev server running:

```bash
curl -i http://localhost:3000/api/users
```

The response should include any headers added by middleware that matched the
request. If middleware returns a `Response` without calling `next()`, the
pipeline does not invoke the route handler.

`execute(request)` runs without a final route handler. It returns a 404
response when every middleware calls `next()`. Use `handle()` when middleware
must wrap a separate route handler.

### Cleanup callbacks

`onTeardown()` registers cleanup for that pipeline instance. Call
`teardown()` when code that created the pipeline shuts down. It does not run
after each response.

```ts
import { MiddlewarePipeline } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline();
const backgroundWork = new AbortController();

pipeline.onTeardown(() => backgroundWork.abort());

export async function stopPipeline(): Promise<void> {
  await pipeline.teardown();
}
```

## Custom middleware

A middleware receives a context object and a `next` function. Access the
request through `context.request`:

```ts
import { type MiddlewareHandler, MiddlewarePipeline } from "veryfront/middleware";

const requireRequestId: MiddlewareHandler = (context, next) => {
  if (!context.request.headers.has("x-request-id")) {
    return Response.json(
      { error: "Missing x-request-id header" },
      { status: 400 },
    );
  }

  return next();
};

export const pipeline = new MiddlewarePipeline().use(requireRequestId);
```

## Project-wide root middleware

Add `middleware.ts`, `middleware.js`, or `middleware.mjs` at the project root to run middleware before every project route. Export one middleware function or an array of functions:

```ts
// middleware.ts
import type { MiddlewareHandler } from "veryfront/middleware";

const requireServiceToken: MiddlewareHandler = (context, next) => {
  const expectedToken = context.env.API_TOKEN;
  if (typeof expectedToken !== "string" || expectedToken.length === 0) {
    return Response.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }

  const authorization = context.request.headers.get("authorization");
  if (authorization !== `Bearer ${expectedToken}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return next();
};

export default requireServiceToken;
```

Store `API_TOKEN` in the project environment. Use an identity provider for
end-user authentication instead of a shared service token.

Root middleware has the same ordering and short-circuit contract in local development, dedicated production servers, and the shared hosted runtime. The shared runtime resolves and compiles the file only after it has authenticated the project and selected its release or preview branch. Middleware receives only that request's project environment through `c.env`.

Production middleware is cached by project, environment, and immutable release or preview branch. Preview cache invalidation reloads the file after source changes, and the cache has a fixed entry limit. A missing file passes through normally.

Production loading is fail-closed. If a declared middleware file cannot be read, compiled, or validated as a middleware export, a dedicated server does not start and a shared server returns an error only for the affected project request. Failed shared loads are not cached, so a corrected deployment can recover without restarting unrelated projects. Development loading remains nonfatal and reports the loading error in the server log.

## Verify it worked

Hit a route with and without the headers the middleware expects:

```bash
# Expect 401 without an Authorization header
curl -i http://localhost:3000/api/protected

# Expect 200 with a valid token
curl -i http://localhost:3000/api/protected \
  -H "Authorization: Bearer <TOKEN>"
```

For CORS, include an `Origin` header and confirm
`Access-Control-Allow-Origin` is set on the response.

For complete types and options, see the
[`veryfront/middleware` API reference](../api-reference/veryfront/middleware.md).
