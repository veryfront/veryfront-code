---
title: "Middleware"
description: "CORS, rate limiting, logging, and custom middleware pipelines."
order: 7
---

# Middleware

CORS, rate limiting, logging, and custom middleware pipelines.

The middleware pipeline works in both router styles. The route module wrapper changes:

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
});
```

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

## Verify it worked

Hit a route with and without the headers the middleware expects:

```bash
# Expect 401 without an Authorization header
curl -i http://localhost:3000/api/protected

# Expect 200 with a valid token
curl -i http://localhost:3000/api/protected \
  -H "Authorization: Bearer dev-token"
```

For CORS, include an `Origin` header and confirm
`Access-Control-Allow-Origin` is set on the response.

## Next

- [OAuth](./oauth.md): add social login to your app
- [API routes](./api-routes.md): the routes that middleware protects

## Related

- [`veryfront/middleware`](../reference/veryfront/middleware.md): middleware API reference
