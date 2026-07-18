---
title: "veryfront/middleware"
description: "CORS, rate limiting, logging, and timeout middleware."
order: 18
---

## Import

```ts
import {
  cors,
  rateLimit,
  logger,
  timeout,
  MiddlewarePipeline,
  authRateLimit,
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

Options accepted by cors.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `origin?` | `string \| string[] \| OriginValidator` | Allowed origins (string, regex, array, or function) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L27) |
| `methods?` | `string[]` | Allowed HTTP methods | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L28) |
| `allowedHeaders?` | `string[]` | Allowed request headers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L29) |
| `exposedHeaders?` | `string[]` | Headers exposed to client | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L30) |
| `credentials?` | `boolean` | Allow credentials | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L31) |
| `maxAge?` | `number` | Preflight cache duration (seconds) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L32) |

### `RateLimitOptions`

Options accepted by rate limit.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `maxRequests?` | `number` | Max requests per window | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L73) |
| `windowMs?` | `number` | Time window (ms) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L74) |
| `store?` | `RateLimitStore` | Storage backend | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L75) |
| `keyGenerator?` | <code>(req: Request) =&gt; string</code> | Function to derive rate limit key from request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L76) |
| `trustProxy?` | `boolean` | Trust proxy-set forwarding headers (X-Forwarded-For) for keying. Defaults to false so forwarded headers are ignored and cannot be used to evade limits. Enable only when a trusted proxy that appends the real client IP sits in front of this middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L83) |

### `LoggerOptions`

Options accepted by logger.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `format?` | `LogFormat` | Log format (combined, common, dev, short) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L18) |
| `skip?` | <code>(req: Request) =&gt; boolean</code> | Skip logging for matching requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L19) |
| `log?` | <code>(message: string) =&gt; void</code> | Custom log output function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L20) |

### `TimeoutOptions`

Options accepted by timeout.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `timeoutMs?` | `number` | Timeout in milliseconds (default: 60000) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L19) |
| `message?` | `string` | Custom message for timeout response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L22) |
| `exclude?` | `string[]` | Paths to exclude from timeout (e.g., health checks) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L25) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `authRateLimit` | Pre-configured rate limiter for authentication endpoints (5 req/15min). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L140) |
| `cors` | Create CORS middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/middleware.ts#L9) |
| `devLogger` | Create development request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L244) |
| `getTimeoutFromEnv` | Gets timeout from environment variable REQUEST_TIMEOUT_MS | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L94) |
| `logger` | Create request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L191) |
| `prodLogger` | Create production request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L249) |
| `rateLimit` | Create rate-limit middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L106) |
| `timeout` | Creates a middleware that enforces request timeouts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L52) |
| `timeoutFromEnv` | Creates a timeout middleware with configuration from environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L102) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryRateLimitStore` | Implement memory rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L25) |
| `MiddlewareContext` | Context for middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/context.ts#L5) |
| `MiddlewarePipeline` | Implement middleware pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/pipeline.ts#L9) |
| `RedisRateLimitStore` | Implement redis rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L38) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthRateLimitOptions` | Options accepted by the authentication rate-limit preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L87) |
| `Context` | Context for context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L8) |
| `CorsOptions` | Options accepted by cors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L26) |
| `ExecutionContext` | Context for execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L2) |
| `LogFormat` | Public API contract for log format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L14) |
| `LoggerOptions` | Options accepted by logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L17) |
| `MiddlewareFactory` | Public API contract for middleware factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L32) |
| `MiddlewareHandler` | Handler for middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L26) |
| `MiddlewarePipelineOptions` | Options accepted by middleware pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/types.ts#L2) |
| `Next` | Public API contract for next. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L23) |
| `RateLimitOptions` | Options accepted by rate limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L72) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L32) |
| `RedisRateLimitOptions` | Options accepted by redis rate limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L32) |
| `TimeoutOptions` | Options accepted by timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L17) |
