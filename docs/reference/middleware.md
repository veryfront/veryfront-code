---
title: "veryfront/middleware"
description: "CORS, rate limiting, logging, and timeout middleware."
order: 15
---

# veryfront/middleware

CORS, rate limiting, logging, and timeout middleware.

## Import

```ts
import {
  cors,
  rateLimit,
  logger,
  timeout,
  MiddlewarePipeline,
  devLogger,
} from "veryfront/middleware";
```

## Examples

### Single middleware

```ts
import { cors } from "veryfront/middleware";

const corsMiddleware = cors({ origin: "https://example.com" });
```

### Pipeline composition

```ts
import { MiddlewarePipeline, cors, rateLimit, logger, timeout } from "veryfront/middleware";

const pipeline = new MiddlewarePipeline()
  .use(cors({ origin: "https://example.com" }))
  .use(rateLimit({ maxRequests: 100, windowMs: 60_000 }))
  .use(logger({ format: "combined" }))
  .use(timeout({ timeoutMs: 30_000 }));
```

## API

### `middlewarePipeline.use(middleware)`

Add a middleware handler to the pipeline.

**Returns:** `this`

### `middlewarePipeline.useFor(pattern, )`

Add a middleware handler that only runs for matching URL patterns.

**Returns:** `this`

### `middlewarePipeline.onTeardown(cb)`

Register a cleanup callback that runs after the response is sent.

**Returns:** `this`

### `middlewarePipeline.compose()`

Compose all registered middleware into a single handler function.

**Returns:** `MiddlewareHandler`

### `middlewarePipeline.execute(req, env, executionCtx, adapter)`

Execute the pipeline for an incoming request.

**Returns:** `Promise<Response>`

### `middlewarePipeline.handle(req, handler)`

Run the middleware pipeline with a final request handler.

**Returns:** `Promise<Response>`

### `middlewarePipeline.teardown()`

Run all registered teardown callbacks.

**Returns:** `Promise<void>`

### `middlewarePipeline.getMiddleware()`

List registered middleware with metadata.

**Returns:** `Array<{ name?: string; order?: number }>`

## Type Reference

### `CorsOptions`

CORS config

| Property | Type | Description |
|----------|------|-------------|
| `origin?` | `string \\| string[] \\| OriginValidator` | Allowed origins (string, regex, array, or function) |
| `methods?` | `string[]` | Allowed HTTP methods |
| `allowedHeaders?` | `string[]` | Allowed request headers |
| `exposedHeaders?` | `string[]` | Headers exposed to client |
| `credentials?` | `boolean` | Allow credentials |
| `maxAge?` | `number` | Preflight cache duration (seconds) |

### `RateLimitOptions`

Rate limit config

| Property | Type | Description |
|----------|------|-------------|
| `maxRequests?` | `number` | Max requests per window |
| `windowMs?` | `number` | Time window (ms) |
| `store?` | `RateLimitStore` | Storage backend |
| `keyGenerator?` | `(req: Request) => string` | Function to derive rate limit key from request |

### `LoggerOptions`

Logger config

| Property | Type | Description |
|----------|------|-------------|
| `format?` | `LogFormat` | Log format (combined, common, dev, short) |
| `skip?` | `(req: Request) => boolean` | Skip logging for matching requests |
| `log?` | `(message: string) => void` | Custom log output function |

### `TimeoutOptions`

Timeout config

| Property | Type | Description |
|----------|------|-------------|
| `timeoutMs?` | `number` | Timeout in milliseconds (default: 60000) |
| `message?` | `string` | Custom message for timeout response |
| `exclude?` | `string[]` | Paths to exclude from timeout (e.g., health checks) |

## Exports

### Functions

| Name | Description |
|------|-------------|
| `cors` | CORS middleware |
| `devLogger` | Dev logger (colorized) |
| `getTimeoutFromEnv` | Gets timeout from environment variable REQUEST_TIMEOUT_MS |
| `logger` | Request/response logger |
| `prodLogger` | Production logger (structured JSON) |
| `rateLimit` | Rate limiting (memory or Redis) |
| `timeout` | Creates a middleware that enforces request timeouts. |
| `timeoutFromEnv` | Creates a timeout middleware with configuration from environment |

### Classes

| Name | Description |
|------|-------------|
| `MemoryRateLimitStore` | In-memory rate limit store |
| `MiddlewareContext` | Middleware pipeline context |
| `MiddlewarePipeline` | Composable middleware chain |
| `RedisRateLimitStore` | Redis rate limit store |

### Types

| Name | Description |
|------|-------------|
| `Context` | Base request context |
| `CorsOptions` | CORS config |
| `ExecutionContext` | Context with execution metadata |
| `LogFormat` | Log format (combined, common, dev, short) |
| `LoggerOptions` | Logger config |
| `MiddlewareFactory` | Middleware factory function |
| `MiddlewareHandler` | Middleware handler function |
| `MiddlewarePipelineOptions` | Pipeline config |
| `Next` | Next middleware callback |
| `RateLimitOptions` | Rate limit config |
| `RateLimitStore` | Rate limit storage interface |
| `RedisRateLimitOptions` | Redis rate limit config |
| `TimeoutOptions` | Timeout config |
