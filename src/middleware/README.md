# Middleware module

The public `veryfront/middleware` entry point provides composable Fetch API
middleware for CORS, rate limits, request logging, timeouts, and route
pipelines.

## Public entry point

```ts
import {
  cors,
  logger,
  type MiddlewareHandler,
  MiddlewarePipeline,
  rateLimit,
  timeout,
} from "veryfront/middleware";
```

| Export                                        | Purpose                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `MiddlewarePipeline`                          | Registers and runs middleware in order.                              |
| `cors`                                        | Applies CORS response headers and handles CORS preflight requests.   |
| `rateLimit`, `authRateLimit`                  | Limits requests with a configurable or authentication preset policy. |
| `MemoryRateLimitStore`, `RedisRateLimitStore` | Store rate-limit counters in memory or Redis.                        |
| `logger`, `devLogger`, `prodLogger`           | Logs request and response metadata.                                  |
| `timeout`, `timeoutFromEnv`                   | Returns a 504 response when downstream work exceeds its deadline.    |
| `MiddlewareHandler`, `Context`, `Next`        | Defines the public middleware contract.                              |

See the [generated API reference](../../docs/api-reference/veryfront/middleware.md)
for every export and option.

## Route pipeline

`handle()` runs middleware around a route handler. Middleware can reject the
request before the handler runs or modify the handler response after
`next()` resolves.

```ts
import { cors, logger, MiddlewarePipeline, rateLimit, timeout } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(logger({ format: "short" }))
  .use(cors({ origin: "https://app.example.com" }))
  .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }))
  .use(timeout({ timeoutMs: 30_000 }));

export function GET(request: Request): Promise<Response> {
  return pipeline.handle(
    request,
    () => Response.json({ status: "ok" }),
  );
}
```

`execute()` runs the pipeline without a route handler. If every middleware
calls `next()`, its terminal response is 404. Use `handle()` when middleware
must wrap a separate route handler.

`rateLimit()` ignores forwarded client-address headers by default and uses a
shared anonymous key. For per-client limits, provide a `keyGenerator` based on
a trusted application identity. Set `trustProxy` only when a trusted reverse
proxy controls the forwarding headers.

For distributed counters, pass a `RedisRateLimitStore` with a Redis URL or set
`REDIS_URL`. Production environments require one of these values. Connection,
command, and disconnect deadlines are bounded and configurable. Call
`destroy()` during application shutdown.

## Middleware contract

A middleware handler receives a request context and a `next` callback. Return
a response to stop the chain, or return `next()` to continue it. Call `next()`
at most once.

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

`use()` registers middleware for every request. `useFor()` registers one or
more handlers for requests whose URL pathname matches a regular expression.
Global middleware runs first, followed by matching scoped middleware in
registration order.

## Lifecycle

`onTeardown()` registers cleanup for that pipeline instance. Call
`teardown()` when code that created the pipeline shuts down. Each registered
callback runs once, even when an earlier callback fails.

```ts
import { MiddlewarePipeline } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline();
const backgroundWork = new AbortController();

pipeline.onTeardown(() => backgroundWork.abort());

export async function stopPipeline(): Promise<void> {
  await pipeline.teardown();
}
```
