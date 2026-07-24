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

### Execute the pipeline

```ts
// app/api/users/route.ts
const users = [{ id: "user_123", name: "Ada Lovelace" }];

export async function GET(request: Request) {
  const result = await pipeline.execute(request);
  if (result) return result; // Middleware returned a response (e.g., rate limit exceeded)

  return Response.json(users);
}
```

The same pipeline can run in a pages router handler by passing `ctx.request`:

```ts
// pages/api/users.ts
import type { APIContext } from "veryfront";

const users = [{ id: "user_123", name: "Ada Lovelace" }];

export async function GET(ctx: APIContext) {
  const result = await pipeline.execute(ctx.request);
  if (result) return result; // Middleware returned a response (e.g., rate limit exceeded)

  return ctx.json(users);
}
```

Try it with the dev server running:

```bash
curl -i http://localhost:3000/api/users
```

The response should include any headers added by the middleware that matched the request. If a middleware returns a `Response`, the route handler stops there and returns that response.

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
