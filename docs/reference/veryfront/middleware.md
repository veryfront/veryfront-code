---
title: "veryfront/middleware"
description: "CORS, rate limiting, logging, and timeout middleware."
order: 16
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

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.handle(req, handler)`

Run the middleware pipeline with a final request handler. Unlike {@link execute}, which returns a 404 when no middleware responds, `handle` invokes the given handler as the terminal step so middleware can add headers, validate auth, etc. before the handler runs.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.teardown()`

Run all registered teardown callbacks.

**Returns:** <code>Promise&lt;void&gt;</code>

### `middlewarePipeline.getMiddleware()`

List registered middleware with metadata.

**Returns:** <code>Array&lt;&#123; name?: string; order?: number &#125;&gt;</code>

## Type Reference

### `CorsOptions`

CORS config

| Property | Type | Description |
|----------|------|-------------|
| `origin?` | `string \| string[] \| OriginValidator` | Allowed origins (string, regex, array, or function) |
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
| `keyGenerator?` | <code>(req: Request) =&gt; string</code> | Function to derive rate limit key from request |

### `LoggerOptions`

Logger config

| Property | Type | Description |
|----------|------|-------------|
| `format?` | `LogFormat` | Log format (combined, common, dev, short) |
| `skip?` | <code>(req: Request) =&gt; boolean</code> | Skip logging for matching requests |
| `log?` | <code>(message: string) =&gt; void</code> | Custom log output function |

### `TimeoutOptions`

Timeout config

| Property | Type | Description |
|----------|------|-------------|
| `timeoutMs?` | `number` | Timeout in milliseconds (default: 60000) |
| `message?` | `string` | Custom message for timeout response |
| `exclude?` | `string[]` | Paths to exclude from timeout (e.g., health checks) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `cors` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/middleware.ts#L7) |
| `devLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L239) |
| `getTimeoutFromEnv` | Gets timeout from environment variable REQUEST_TIMEOUT_MS | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L92) |
| `logger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L187) |
| `prodLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L243) |
| `rateLimit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L83) |
| `timeout` | Creates a middleware that enforces request timeouts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L50) |
| `timeoutFromEnv` | Creates a timeout middleware with configuration from environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L100) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryRateLimitStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L30) |
| `MiddlewareContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/context.ts#L3) |
| `MiddlewarePipeline` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/pipeline.ts#L7) |
| `RedisRateLimitStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L21) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Context` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L5) |
| `CorsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L24) |
| `ExecutionContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts) |
| `LogFormat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L12) |
| `LoggerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L14) |
| `MiddlewareFactory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L26) |
| `MiddlewareHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L21) |
| `MiddlewarePipelineOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/types.ts) |
| `Next` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L19) |
| `RateLimitOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L76) |
| `RateLimitStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L30) |
| `RedisRateLimitOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L16) |
| `TimeoutOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L15) |

## Related

User guides:

- [middleware](../../guides/middleware.md): Compose HTTP middleware
- [api-routes](../../guides/api-routes.md): Apply middleware to API routes
