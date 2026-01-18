# Rate Limiting Middleware

Protection against abuse and DoS attacks through configurable rate limiting.

## Features

- ✅ **Multiple Strategies**: Fixed window, sliding window, token bucket
- ✅ **Flexible Storage**: Memory store (default), or custom implementations
- ✅ **Custom Key Generation**: Rate limit by IP, API key, user ID, etc.
- ✅ **Skip Logic**: Bypass rate limiting for specific requests
- ✅ **Rate Limit Headers**: Standard `X-RateLimit-*` headers
- ✅ **Preset Configurations**: Ready-to-use configs for common use cases

## Quick Start

```typescript
import { RateLimitPresets } from "veryfront/security/rate-limit";

// Use a preset
const rateLimiter = RateLimitPresets.moderate(); // 100 req/min

// Apply in your handler
export async function handler(request: Request) {
  return await rateLimiter(request, async (req) => {
    // Your handler logic
    return new Response("OK");
  });
}
```

## Strategies

### Fixed Window

Simple counter that resets at fixed intervals. Fast but allows bursts at boundaries.

```typescript
import { createRateLimiter } from "veryfront/security/rate-limit";

const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000, // 1 minute
  strategy: "fixed-window",
});
```

### Sliding Window

More accurate, prevents burst attacks by tracking individual timestamps.

```typescript
const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000,
  strategy: "sliding-window",
});
```

### Token Bucket

Allows controlled bursts. Tokens refill at constant rate.

```typescript
const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000,
  strategy: "token-bucket",
});
```

## Custom Configuration

### Rate Limit by API Key

```typescript
const limiter = createRateLimiter({
  maxRequests: 1000,
  windowMs: 3600000, // 1 hour
  keyGenerator: (request) => {
    return request.headers.get("x-api-key") || "anonymous";
  },
});
```

### Skip Admin Users

```typescript
const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000,
  skip: async (request) => {
    const apiKey = request.headers.get("x-api-key");
    return apiKey === process.env.ADMIN_API_KEY;
  },
});
```

### Custom Error Response

```typescript
const limiter = createRateLimiter({
  maxRequests: 10,
  windowMs: 60000,
  onRateLimitExceeded: (request, key) => {
    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        key,
        message: "Please upgrade to premium for higher limits",
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
});
```

## Presets

### Strict (10 req/min)

For sensitive operations.

```typescript
RateLimitPresets.strict();
```

### Moderate (100 req/min)

For general web pages.

```typescript
RateLimitPresets.moderate();
```

### Lenient (1000 req/hour)

For public APIs.

```typescript
RateLimitPresets.lenient();
```

### Auth (5 req/15min)

For authentication endpoints.

```typescript
RateLimitPresets.auth();
```

## Custom Store

For distributed systems, implement the `RateLimitStore` interface:

```typescript
import type { RateLimitStore } from "veryfront/security/rate-limit";

class RedisRateLimitStore implements RateLimitStore {
  async increment(key: string): Promise<number> {
    // Implement with Redis
  }

  async get(key: string): Promise<number> {
    // Implement with Redis
  }

  async reset(key: string): Promise<void> {
    // Implement with Redis
  }

  async resetAll(): Promise<void> {
    // Implement with Redis
  }
}

const limiter = createRateLimiter({
  maxRequests: 100,
  windowMs: 60000,
  store: new RedisRateLimitStore(),
});
```

## Response Headers

All responses include rate limit headers:

- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

When rate limit is exceeded:

- HTTP status: `429 Too Many Requests`
- `Retry-After`: Seconds to wait before retrying

## Best Practices

1. **Use appropriate limits**: Don't over-limit legitimate users
2. **Choose right strategy**:
   - Fixed window: Fast, good for most cases
   - Sliding window: More accurate, prevents burst attacks
   - Token bucket: Allow controlled bursts
3. **Monitor limits**: Track `429` responses to tune limits
4. **Fail open**: If rate limiting errors, allow request through
5. **Distributed systems**: Use Redis or similar for shared state

## Examples

### Protect API Endpoint

```typescript
// app/api/users/route.ts
import { RateLimitPresets } from "veryfront/security/rate-limit";

const limiter = RateLimitPresets.moderate();

export async function GET(request: Request) {
  return await limiter(request, async () => {
    const users = await db.users.findMany();
    return Response.json(users);
  });
}
```

### Protect Authentication

```typescript
// app/api/auth/login/route.ts
import { RateLimitPresets } from "veryfront/security/rate-limit";

const limiter = RateLimitPresets.auth();

export async function POST(request: Request) {
  return await limiter(request, async () => {
    const { email, password } = await request.json();
    // ... authentication logic
  });
}
```

### Different Limits per Tier

```typescript
import { createRateLimiter } from "veryfront/security/rate-limit";

const limiter = createRateLimiter({
  maxRequests: 100, // Default
  windowMs: 60000,
  keyGenerator: (request) => {
    const tier = request.headers.get("x-user-tier");
    return `${tier}:${request.headers.get("x-api-key")}`;
  },
  onRateLimitExceeded: async (request, key) => {
    const tier = key.split(":")[0];
    const limits = {
      free: 100,
      pro: 1000,
      enterprise: 10000,
    };

    return new Response(
      JSON.stringify({
        error: "Rate limit exceeded",
        limit: limits[tier] || 100,
        message: "Upgrade for higher limits",
      }),
      { status: 429 },
    );
  },
});
```

## Testing

```typescript
import { createRateLimiter } from "veryfront/security/rate-limit";

Deno.test("rate limiter blocks after limit", async () => {
  const limiter = createRateLimiter({
    maxRequests: 2,
    windowMs: 60000,
  });

  const request = new Request("http://localhost/test");
  const handler = async () => new Response("OK");

  // First 2 should succeed
  await limiter(request, handler);
  await limiter(request, handler);

  // 3rd should be blocked
  const response = await limiter(request, handler);
  assertEquals(response.status, 429);
});
```

## See Also

- [Security Overview](../README.md)
- [Input Validation](../input-validation/)
- [Path Validation](../path-validation.ts)
