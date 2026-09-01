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

#### Choose who owns preflight

Global `security.cors` is authoritative for CORS headers on automatic
preflight, explicit `OPTIONS`, and actual route responses:

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  security: {
    cors: {
      origin: "https://example.com",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    },
  },
});
```

Method-local `cors()` middleware runs only inside the handler that calls it.
It does not configure the framework-generated automatic `OPTIONS` response and
cannot override the global policy after route dispatch.

An explicit `OPTIONS` export is authoritative for the response status, body,
and non-CORS headers. Veryfront uses automatic preflight only when the matched
route has no executable `OPTIONS` handler. A callable default Pages route is
also authoritative for `OPTIONS` and must branch on `ctx.request.method` when
it owns multiple methods. Veryfront replaces policy-owned CORS headers on both
forms with the validated global `security.cors` policy.

An unauthenticated preflight for an auth-protected route is the exception.
Veryfront returns automatic preflight without executing the explicit handler,
so the browser can evaluate the global CORS policy before the actual request
performs application authentication.

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

Use `handle()` to run the middleware chain and then your route handler. If a middleware short-circuits (returns a `Response`, for example a rate-limit rejection), `handle()` returns that response and your handler never runs; otherwise your handler runs as the terminal step:

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

> **`handle()` vs `execute()`.** `execute()` is a lower-level variant with **no terminal handler**: it returns the short-circuiting middleware's `Response`, or a synthesized **404 Not Found** when the chain passes through. It always resolves to a `Response` (never `undefined`), so `if (await pipeline.execute(request))` is always truthy; use `execute()` only when a middleware is always expected to produce the response. For the common "middleware, then my route handler" case, prefer `handle()`.

### In-memory state across requests

Middleware and route handlers created at module scope, for example a `rateLimit()` store or a module-level counter, behave differently by environment:

- **In development**, the dev server re-evaluates each route module on every request so edits hot-reload. A fresh module scope means module-level variables and default in-memory stores are re-created per request: a counter always reads back its initial value, and the default in-memory rate-limit store never accumulates across requests. To exercise threshold behavior in dev, drive the pipeline multiple times within a single request, or use an external store.
- **In production**, the compiled route module is cached per release, so module-scoped state persists across requests **within one server process and one release**. It is still **not** shared across multiple instances, and it resets on every redeploy (and under memory-pressure eviction).

For anything that must be correct across requests, instances, and deploys, such as rate limiting, counters, and sessions, use an external store (see the `RateLimitStore` interface and the Redis example in the rate-limit reference) rather than module-scoped memory.

### Cleanup callbacks

Register teardown logic that runs once per request, after the response body has
finished, been canceled, or errored:

```ts
pipeline.onTeardown(async () => {
  await flushMetrics();
});
```

`onTeardown` callbacks run for every `handle()` and `execute()` call, so a
module-scoped route pipeline fires them on each request. For streamed responses,
cleanup waits until the body reaches EOF, is canceled by the consumer, or
errors. Bodyless, locked, or already-read responses and handler or middleware
exceptions clean up before the `handle()`/`execute()` promise resolves. Callback
errors are logged and swallowed, never surfaced to the client.

For long-lived pipelines that need one-shot cleanup on shutdown rather than per
request, call `pipeline.teardown()` explicitly. Unlike the per-request run,
`teardown()` drains and discards the callbacks so they never fire again.

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

Root middleware runs in front of your project's routes, not in front of the platform's. A control-plane dispatch is the signed request the platform sends to your runtime to build a release asset manifest for a deploy, or to start, resume, or cancel a run. It bypasses root middleware and goes straight to the handler that verifies its signature.

Middleware could not authorize one of these requests in any case. Infrastructure headers, including the dispatch signature, are withheld from project code, so middleware that gates on a credential rejects the platform's request to build your own deploy.

The signature-keyed bypass is narrow. It applies only to a request that both addresses one of those platform routes and carries the signature header the receiving handler verifies. An unsigned request to `POST /api/control-plane/runs/{runId}/execute`, an unsigned request to the agents list route, and any other path under `/api/control-plane/`, including your own routes in that namespace, still run your middleware.

Three run-lifecycle routes are a longstanding exception and bypass middleware whether or not they are signed: `POST /api/control-plane/runs/{runId}/stream`, `POST /api/control-plane/runs/{runId}/resume`, and `DELETE /api/control-plane/runs/{runId}`. Do not rely on middleware to gate those three paths.

A signed channel dispatch bypasses root middleware on the same terms. This is the request the platform sends to `POST /channels/invoke` to run one of your agents on a message from Slack or Discord, and it carries its own envelope under its own header, verified by the channel handler rather than by the control-plane signature check. Your middleware does not run for your project's channel traffic. An unsigned request to `POST /channels/invoke` still runs your middleware.

Production loading is fail-closed. If a declared middleware file cannot be read, compiled, or validated as a middleware export, a dedicated server does not start and a shared server returns an error only for the affected project request. Failed shared loads are not cached, so a corrected deployment can recover without restarting unrelated projects. Development loading remains nonfatal and reports the loading error in the server log.

## Application authorization after login

Use [Application authentication](./application-auth.md) when the whole app needs
a framework-owned login boundary. Veryfront admits the request before
middleware runs, then middleware can apply application authorization using the
normalized identity. Keep per-route policy in middleware or route code.

## Example: site-wide HTTP Basic Auth

A common use of root middleware is password-gating an entire site: a staging
environment, a preview, an internal tool.

### Prefer the built-in gate

Before writing middleware, know that the runtime ships this as configuration.
Set the operator environment variables in the deployment environment:

```bash
VERYFRONT_BASIC_USER=demo-user
VERYFRONT_BASIC_PASS=demo-pass
```

or configure it per project:

```ts
// veryfront.config.ts
import { getEnv } from "veryfront";

export default {
  security: {
    auth: {
      basic: {
        username: "demo-user",
        // An unset password fails config validation, which is the safe failure.
        password: getEnv("BASIC_AUTH_PASS") ?? "",
        realm: "Staging",
      },
    },
  },
};
```

Read config secrets through `getEnv` from `veryfront`, not `process.env`: the
hosted declarative config evaluator rejects `process.env` access as a
forbidden capability, while `getEnv` works in local, dedicated, and shared
runtimes.

The built-in gate compares credentials in constant time and keeps the
platform's health probes and signed control-plane traffic working, so prefer
it whenever "one username and password for the whole site" is all you need.
(`security.auth.bearer` is the token-header equivalent; configure one or the
other, not both.)

### Custom Basic Auth middleware

Write it yourself when you need logic the built-in gate does not have, say,
exempting a public path or accepting several credential pairs. This is the
root `middleware.ts` file described above, which every runtime, including the
shared hosted runtime, compiles and runs. Do not confuse it with the
`middleware.custom` config option: config-declared middleware functions are
rejected by hosted runtimes and work only when you run or self-host the
project yourself.

```ts
// middleware.ts
import type { MiddlewareHandler } from "veryfront/middleware";

function unauthorized(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Demo", charset="UTF-8"',
    },
  });
}

const basicAuth: MiddlewareHandler = async (c, next) => {
  // Credentials come from the project environment: the shared hosted runtime
  // delivers it through `c.env`, while local development and dedicated
  // servers expose it as `process.env`. Fail closed: if none are configured,
  // nobody gets in. Never ship fallback credentials in code.
  const user = String(c.env.BASIC_AUTH_USER ?? process.env.BASIC_AUTH_USER ?? "");
  const pass = String(c.env.BASIC_AUTH_PASS ?? process.env.BASIC_AUTH_PASS ?? "");
  if (!user || !pass) return unauthorized();

  const header = c.request.headers.get("authorization") ?? "";
  // The scheme name is case-insensitive: "basic" is as valid as "Basic".
  if (header.slice(0, 6).toLowerCase() !== "basic ") return unauthorized();

  let decoded: string;
  try {
    // atob() yields one byte per character; decode those bytes as UTF-8 so
    // non-ASCII credentials compare correctly.
    const binary = atob(header.slice(6));
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    );
  } catch {
    return unauthorized(); // malformed base64 or invalid UTF-8
  }

  const sep = decoded.indexOf(":");
  if (sep === -1) return unauthorized();

  if (decoded.slice(0, sep) === user && decoded.slice(sep + 1) === pass) {
    return next();
  }
  return unauthorized();
};

export default basicAuth;
```

Set `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` in the project environment
(`.env` locally, the environment settings of your deployment in production)
and try it:

```bash
# Expect 401 with a WWW-Authenticate challenge
curl -i http://localhost:3000/

# Expect the page with the demo credentials
curl -i -u demo-user:demo-pass http://localhost:3000/
```

Two things the hand-rolled version gives up relative to the built-in gate:
the `===` comparisons are not constant-time, and the exemptions described
above still apply: signed platform dispatches bypass root middleware, so
this gates your visitors, not the platform's own traffic.

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
