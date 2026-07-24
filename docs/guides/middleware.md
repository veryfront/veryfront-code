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

### Logging

```ts
import { logger } from "veryfront/middleware";

const log = logger({ format: "combined" }); // "combined" | "common" | "short" | "dev"
```

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
const pipeline = new MiddlewarePipeline()
  .use(cors({ origin: "*" }))
  .useFor(/^\/api\//, rateLimit({ maxRequests: 50, windowMs: 60_000 }))
  .useFor(/^\/api\/chat\//, timeout({ timeoutMs: 120_000 }));
```

### Run the pipeline

Use `handle()` to run the middleware chain and then your route handler. If a middleware short-circuits (returns a `Response` — e.g. a rate-limit rejection), `handle()` returns that response and your handler never runs; otherwise your handler runs as the terminal step:

```ts
// app/api/users/route.ts
const users = [{ id: "user_123", name: "Ada Lovelace" }];

export function GET(request: Request) {
  return pipeline.handle(request, () => Response.json(users));
}
```

The same pipeline runs in a pages router handler via `ctx.request`:

```ts
// pages/api/users.ts
import type { APIContext } from "veryfront";

const users = [{ id: "user_123", name: "Ada Lovelace" }];

export function GET(ctx: APIContext) {
  return pipeline.handle(ctx.request, () => ctx.json(users));
}
```

Try it with the dev server running:

```bash
curl -i http://localhost:3000/api/users
```

The response includes any headers added by the middleware that matched the request.

> **`handle()` vs `execute()`.** `execute()` is a lower-level variant with **no terminal handler**: it returns the short-circuiting middleware's `Response`, or a synthesized **404 Not Found** when the chain passes through. It always resolves to a `Response` (never `undefined`), so `if (await pipeline.execute(req))` is always truthy — use `execute()` only when a middleware is always expected to produce the response. For the common "middleware, then my route handler" case, prefer `handle()`.

### In-memory state across requests

Middleware and route handlers created at module scope — for example a `rateLimit()` store, or a module-level counter — behave differently by environment:

- **In development**, the dev server re-evaluates each route module on every request so edits hot-reload. A fresh module scope means module-level variables and default in-memory stores are re-created per request: a counter always reads back its initial value, and the default in-memory rate-limit store never accumulates across requests. To exercise threshold behavior in dev, drive the pipeline multiple times within a single request, or use an external store.
- **In production**, the compiled route module is cached per release, so module-scoped state persists across requests **within one server process and one release**. It is still **not** shared across multiple instances, and it resets on every redeploy (and under memory-pressure eviction).

For anything that must be correct across requests, instances, and deploys — rate limiting, counters, sessions — use an external store (see the `RateLimitStore` interface and the Redis example in the rate-limit reference) rather than module-scoped memory.

### Cleanup callbacks

Register teardown logic that runs after the response is sent:

```ts
pipeline.onTeardown(async () => {
  await flushMetrics();
});
```

## Custom middleware

A middleware is a function that receives a context object and a `next` function. Access the request via `c.request`:

```ts
import type { MiddlewareHandler } from "veryfront/middleware";

const auth: MiddlewareHandler = async (c, next) => {
  const token = c.request.headers.get("authorization");
  if (!token) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Continue to the next middleware or route handler
  return next();
};
```

Add it to a pipeline:

```ts
const pipeline = new MiddlewarePipeline()
  .use(auth)
  .use(cors({ origin: "*" }));
```

## Project-wide root middleware

Add `middleware.ts`, `middleware.js`, or `middleware.mjs` at the project root to run middleware before every project route. Export one middleware function or an array of functions:

```ts
// middleware.ts
import type { MiddlewareHandler } from "veryfront/middleware";

const requireAccess: MiddlewareHandler = async (c, next) => {
  if (!c.request.headers.has("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const response = await next();
  response?.headers.set("x-project-middleware", "applied");
  return response;
};

export default requireAccess;
```

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
