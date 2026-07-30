---
title: "veryfront/middleware"
description: "CORS, rate limiting, logging, and timeout middleware."
order: 20
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

### `middlewarePipeline.useFor(pattern, ...handlers)`

Add a middleware handler that only runs for matching URL patterns.

**Returns:** `this`

### `middlewarePipeline.onTeardown(cb)`

Register a cleanup callback that runs once per request after each `execute()`/`handle()` response body closes, is canceled, or errors. Bodyless, locked, or already-read responses and handler/middleware exceptions clean up before the call resolves.

**Returns:** `this`

### `middlewarePipeline.compose()`

Compose all registered middleware into a single handler function.

**Returns:** `MiddlewareHandler`

### `middlewarePipeline.execute(req, env, executionCtx, adapter)`

Execute the pipeline for an incoming request.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.handle(req, handler)`

Run the middleware pipeline with a final request handler. Unlike `execute`, which returns a 404 when no middleware responds, `handle` invokes the given handler as the terminal step so middleware can add headers, validate auth, etc. before the handler runs.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.teardown()`

Drain and discard all registered teardown callbacks. Unlike the per-request cleanup run by `execute()` / `handle()`, this clears callbacks so they never run again.

**Returns:** <code>Promise&lt;void&gt;</code>

### `middlewarePipeline.getMiddleware()`

List registered middleware with metadata.

**Returns:** <code>Array&lt;&#123; name?: string; order?: number &#125;&gt;</code>

## Type Reference

### `CorsOptions`

Legacy-compatible CORS option subset retained for middleware consumers.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `origin?` | `string \| string[] \| OriginValidator` | Allowed origin, origin list, or boolean validator | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L39) |
| `methods?` | `string[]` | Allowed HTTP methods | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L40) |
| `allowedHeaders?` | `string[]` | Allowed request headers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L41) |
| `exposedHeaders?` | `string[]` | Headers exposed to client | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L42) |
| `credentials?` | `boolean` | Allow credentials | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L43) |
| `maxAge?` | `number` | Preflight cache duration (seconds) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L44) |

### `RateLimitOptions`

Options accepted by rate limit.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `maxRequests?` | `number` | Max requests per window | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L132) |
| `windowMs?` | `number` | Time window (ms) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L133) |
| `store?` | `RateLimitStore` | Storage backend | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L134) |
| `keyGenerator?` | <code>(req: Request) =&gt; string</code> | Function to derive rate limit key from request | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L135) |
| `trustProxy?` | `boolean` | Trust proxy-set forwarding headers (X-Forwarded-For) for keying. Defaults to false so forwarded headers are ignored and cannot be used to evade limits. Enable only when a trusted proxy that appends the real client IP sits in front of this middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L142) |

### `LoggerOptions`

Options accepted by logger.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `format?` | `LogFormat` | Log format (combined, common, dev, short) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L19) |
| `skip?` | <code>(req: Request) =&gt; boolean</code> | Skip logging for matching requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L20) |
| `log?` | <code>(message: string) =&gt; void</code> | Custom log output function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L21) |

### `TimeoutOptions`

Options accepted by timeout.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `timeoutMs?` | `number` | Timeout in milliseconds (default: 75000) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L21) |
| `message?` | `string` | Custom message for timeout response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L24) |
| `exclude?` | `string[]` | Paths to exclude from timeout (e.g., health checks) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L27) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `authRateLimit` | Pre-configured rate limiter for authentication endpoints (5 req/15min). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L291) |
| `cors` | Create CORS middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/middleware.ts#L10) |
| `createDistributedRateLimitStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/distributed-rate-limit.ts#L12) |
| `devLogger` | Create development request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L283) |
| `getTimeoutFromEnv` | Gets timeout from environment variable REQUEST_TIMEOUT_MS | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L151) |
| `logger` | Create request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L201) |
| `prodLogger` | Create production request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L288) |
| `rateLimit` | Create rate-limit middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L207) |
| `timeout` | Creates a middleware that enforces request timeouts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L91) |
| `timeoutFromEnv` | Creates a timeout middleware with configuration from environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L169) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryRateLimitStore` | Implement memory rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L37) |
| `MiddlewareContext` | Context for middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/context.ts#L6) |
| `MiddlewarePipeline` | Implement middleware pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/pipeline.ts#L9) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthRateLimitOptions` | Options accepted by the authentication rate-limit preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L146) |
| `Context` | Context for context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L8) |
| `CorsOptions` | Legacy-compatible CORS option subset retained for middleware consumers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/types.ts#L38) |
| `DistributedRateLimitStoreOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L77) |
| `ExecutionContext` | Context for execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L2) |
| `LogFormat` | Public API contract for log format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L15) |
| `LoggerOptions` | Options accepted by logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L18) |
| `MemoryRateLimitStoreOptions` | Options accepted by the in-memory rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L122) |
| `MiddlewareFactory` | Public API contract for middleware factory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L32) |
| `MiddlewareHandler` | Handler for middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L26) |
| `MiddlewarePipelineOptions` | Options accepted by middleware pipeline. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/types.ts#L2) |
| `Next` | Public API contract for next. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L23) |
| `RateLimitOptions` | Options accepted by rate limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L131) |
| `RateLimitStore` | Public API contract for rate limit store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L32) |
| `TimeoutOptions` | Options accepted by timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L19) |
