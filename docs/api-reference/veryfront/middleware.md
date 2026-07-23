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

Append middleware to every request.

**Returns:** `this`

### `middlewarePipeline.useFor(pattern, ...handlers)`

Append middleware for requests whose path matches a regular expression.

**Returns:** `this`

### `middlewarePipeline.onTeardown(cb)`

Register a callback that runs once during pipeline teardown.

**Returns:** `this`

### `middlewarePipeline.compose()`

Compose registered middleware into one reusable handler.

**Returns:** `MiddlewareHandler`

### `middlewarePipeline.execute(req, env, executionCtx, adapter)`

Execute middleware and return 404 if no middleware responds.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.handle(req, handler)`

Run the middleware pipeline with a final request handler. Unlike `execute`, which returns a 404 when no middleware responds, `handle` invokes the given handler as the terminal step so middleware can add headers or validate access before the handler runs.

**Returns:** <code>Promise&lt;Response&gt;</code>

### `middlewarePipeline.teardown()`

Run and clear registered teardown callbacks.

**Returns:** <code>Promise&lt;void&gt;</code>

### `middlewarePipeline.getMiddleware()`

List globally registered middleware in execution order.

**Returns:** <code>Array&lt;&#123; name?: string; order?: number &#125;&gt;</code>

## Type Reference

### `CorsOptions`

Cross-origin resource sharing policy.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `origin?` | `string \| string[] \| OriginValidator` | Allowed origin, origin list, or dynamic validator. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L7) |
| `credentials?` | `boolean` | Allow browsers to expose credentials to cross-origin requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L9) |
| `methods?` | `string[]` | HTTP methods accepted by preflight requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L11) |
| `allowedHeaders?` | `string[]` | Request headers accepted by preflight requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L13) |
| `exposedHeaders?` | `string[]` | Response headers exposed to browser code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L15) |
| `maxAge?` | `number` | Browser preflight cache duration in seconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L17) |

### `RateLimitOptions`

Options accepted by rate limit.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `maxRequests?` | `number` | Maximum requests allowed in each window. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L130) |
| `windowMs?` | `number` | Window duration in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L132) |
| `store?` | `RateLimitStore` | Counter storage backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L134) |
| `keyGenerator?` | <code>(req: Request) =&gt; string</code> | Derive a stable, non-sensitive key no longer than 1024 characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L136) |
| `trustProxy?` | `boolean` | Trust proxy-set forwarding headers (X-Forwarded-For) for keying. Defaults to false so forwarded headers are ignored and cannot be used to evade limits. Enable only when a trusted proxy that appends the real client IP sits in front of this middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L143) |

### `RedisRateLimitOptions`

Options for Redis-backed rate limiting.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `url?` | `string` | Redis connection URL using the redis: or rediss: scheme. Defaults to REDIS_URL. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L116) |
| `keyPrefix?` | `string` | Prefix added to rate-limit keys. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L118) |
| `connectTimeoutMs?` | `number` | Connection deadline in milliseconds. Defaults to 10000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L120) |
| `operationTimeoutMs?` | `number` | Command and disconnect deadline in milliseconds. Defaults to 10000. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L122) |

### `LoggerOptions`

Options accepted by logger.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `format?` | `LogFormat` | Output layout. Defaults to `dev`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L19) |
| `skip?` | <code>(req: Request) =&gt; boolean</code> | Return true to omit a request from logging. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L21) |
| `log?` | <code>(message: string) =&gt; void</code> | Optional destination for fully formatted log lines. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L23) |

### `TimeoutOptions`

Options accepted by timeout.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `timeoutMs?` | `number` | Timeout in milliseconds. Defaults to 60000 and must fit a runtime timer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L53) |
| `message?` | `string` | Timeout response message, limited to 1024 characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L56) |
| `exclude?` | `string[]` | Up to 128 absolute URL paths to exclude, including nested paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L59) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `authRateLimit` | Create a rate limiter for authentication endpoints (5 requests per 15 minutes). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L224) |
| `cors` | Create CORS middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/index.ts#L44) |
| `devLogger` | Create development request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L278) |
| `getTimeoutFromEnv` | Read the request timeout from the environment configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L143) |
| `logger` | Create request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L203) |
| `prodLogger` | Create production request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L283) |
| `rateLimit` | Create rate-limit middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L169) |
| `timeout` | Create middleware that enforces request timeouts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L94) |
| `timeoutFromEnv` | Create timeout middleware using the environment configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L155) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryRateLimitStore` | Store rate-limit counters in bounded process memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L64) |
| `MiddlewareContext` | Request-scoped context passed to middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/context.ts#L5) |
| `MiddlewarePipeline` | Compose and execute request middleware that returns standard web responses. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/pipeline.ts#L123) |
| `RedisRateLimitStore` | Store rate-limit counters in Redis with atomic increments and expirations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L126) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `AuthRateLimitOptions` | Options accepted by the authentication rate-limit preset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L147) |
| `Context` | Request state and response helpers available to middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L20) |
| `CorsOptions` | Cross-origin resource sharing policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L5) |
| `ExecutionContext` | Platform execution hooks available to request middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L4) |
| `LogFormat` | Output format used by request logging middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L14) |
| `LoggerOptions` | Options accepted by logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/logger.ts#L17) |
| `MiddlewareExecutionAdapter` | Environment access required for middleware error handling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L12) |
| `MiddlewareFactory` | Create middleware from optional configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L64) |
| `MiddlewareHandler` | Handler for middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L49) |
| `MiddlewarePipelineOptions` | Reserved pipeline options. No options are currently supported. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/pipeline/types.ts#L2) |
| `Next` | Continue to the next middleware or terminal request handler. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/core/types.ts#L46) |
| `OriginValidator` | Resolve whether an incoming origin is allowed, optionally returning a replacement origin. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/security/http/cors/types.ts#L2) |
| `RateLimitEntry` | Current counter state for one rate-limit key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L27) |
| `RateLimitOptions` | Options accepted by rate limit. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/rate-limit.ts#L128) |
| `RateLimitStore` | Storage contract for rate-limit counters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/types.ts#L35) |
| `RedisRateLimitOptions` | Options for Redis-backed rate limiting. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/security/redis-rate-limit.ts#L114) |
| `TimeoutEnvironmentConfig` | Environment values used to resolve the request timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L63) |
| `TimeoutOptions` | Options accepted by timeout. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/middleware/builtin/timeout.ts#L51) |
