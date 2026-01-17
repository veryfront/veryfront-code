# Middleware Module

The Middleware module provides a Hono-inspired composable middleware pipeline for request/response handling with built-in middleware for common use cases.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { cors, logger, MiddlewarePipeline, securityHeaders } from "#middleware";

// Using barrel file
import { cors, logger, MiddlewarePipeline, securityHeaders } from "./middleware/index.ts";
```

## Public API Overview

The Middleware module exports:

- **`MiddlewarePipeline`** - Core middleware execution engine
- **`MiddlewareContext`** - Request/response context with helpers
- **Built-in Middleware** - CORS, logger, security headers, rate limiting, etc.
- **Type Definitions** - `MiddlewareHandler`, `Context`, `Next`, etc.

## File Structure

```
middleware/
├── index.ts                    # Public API (barrel file) ← USE THIS
├── README.md                   # This file
├── core/                       # Core middleware system
│   ├── index.ts
│   ├── pipeline/               # Pipeline implementation
│   │   ├── index.ts
│   │   ├── pipeline.ts
│   │   └── context.ts
│   └── types.ts                # Core type definitions
└── builtin/                    # Built-in middleware
    ├── index.ts
    ├── cors.ts                 # CORS middleware
    ├── logger.ts               # Request logger
    ├── security-headers.ts     # Security headers
    ├── rate-limiter.ts         # Rate limiting
    ├── compression.ts          # Response compression
    └── error-handler.ts        # Error handling
```

## Quick Start

### Basic Pipeline

```ts
import { MiddlewarePipeline } from "#middleware";

const pipeline = new MiddlewarePipeline();

// Add middleware
pipeline.use(async (context, next) => {
  console.log("Before:", context.req.url);
  const response = await next();
  console.log("After:", response.status);
  return response;
});

// Execute pipeline
const response = await pipeline.execute(request);
```

### Using Built-in Middleware

```ts
import { cors, logger, MiddlewarePipeline, securityHeaders } from "#middleware";

const pipeline = new MiddlewarePipeline();

// Add built-in middleware
pipeline.use(logger({ format: "dev" }));
pipeline.use(cors({
  origin: ["https://example.com"],
  methods: ["GET", "POST"],
  credentials: true,
}));
pipeline.use(securityHeaders({
  contentSecurityPolicy: true,
  xFrameOptions: "DENY",
}));

// Add custom handler
pipeline.use(async (ctx) => {
  return new Response("Hello World");
});

// Execute
const response = await pipeline.execute(request);
```

## Built-in Middleware

### CORS

Cross-Origin Resource Sharing configuration:

```ts
import { cors } from "#middleware";

pipeline.use(cors({
  origin: ["https://example.com", "https://app.example.com"],
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));
```

### Logger

Request/response logging:

```ts
import { logger } from "#middleware";

// Development format (colorized, detailed)
pipeline.use(logger({ format: "dev" }));

// Production format (JSON structured logging)
pipeline.use(logger({ format: "json" }));

// Custom format
pipeline.use(logger({
  format: "custom",
  customFormat: (ctx, start, end) => {
    return `${ctx.req.method} ${ctx.req.url} ${end - start}ms`;
  },
}));
```

### Security Headers

Common security headers:

```ts
import { securityHeaders } from "#middleware";

pipeline.use(securityHeaders({
  contentSecurityPolicy: {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'"],
    "style-src": ["'self'", "'unsafe-inline'"],
  },
  xFrameOptions: "DENY",
  xContentTypeOptions: "nosniff",
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: {
    "camera": [],
    "microphone": [],
    "geolocation": ["self"],
  },
}));
```

### Rate Limiter

Request rate limiting:

```ts
import { rateLimiter } from "#middleware";

pipeline.use(rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100, // 100 requests per window
  keyGenerator: (req) => {
    // Use IP address as key
    return req.headers.get("x-forwarded-for") || "unknown";
  },
  handler: async (ctx) => {
    return new Response("Too Many Requests", { status: 429 });
  },
}));
```

### Compression

Response compression (gzip/brotli):

```ts
import { compression } from "#middleware";

pipeline.use(compression({
  threshold: 1024, // Compress responses > 1KB
  level: 6, // Compression level (1-9)
  encodings: ["br", "gzip"], // Prefer brotli, fallback to gzip
}));
```

### Error Handler

Global error handling:

```ts
import { errorHandler } from "#middleware";

// Add first in pipeline to catch all errors
pipeline.use(errorHandler({
  // Development: show stack traces
  showStackTrace: process.env.NODE_ENV === "development",

  // Custom error response
  onError: (error, ctx) => {
    console.error("Middleware error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        stack: error.stack,
      }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  },
}));
```

## Creating Custom Middleware

### Simple Middleware

```ts
import type { MiddlewareHandler } from "#middleware";

const customMiddleware: MiddlewareHandler = async (ctx, next) => {
  // Before request
  ctx.set("startTime", Date.now());

  // Call next middleware
  const response = await next();

  // After request
  const duration = Date.now() - ctx.get("startTime");
  response.headers.set("X-Response-Time", `${duration}ms`);

  return response;
};

pipeline.use(customMiddleware);
```

### Middleware Factory

```ts
import type { MiddlewareFactory } from "#middleware";

interface AuthOptions {
  secret: string;
  algorithm?: string;
}

const auth: MiddlewareFactory<AuthOptions> = (options) => {
  return async (ctx, next) => {
    const token = ctx.req.headers.get("Authorization");

    if (!token) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Verify token with options.secret
    const user = await verifyToken(token, options.secret);
    ctx.set("user", user);

    return next();
  };
};

// Use with options
pipeline.use(auth({ secret: process.env.JWT_SECRET }));
```

## Context API

The middleware context provides helpers for common operations:

```ts
// Request helpers
ctx.req.url; // Request URL
ctx.req.method; // HTTP method
ctx.req.headers; // Headers object
await ctx.req.json(); // Parse JSON body
await ctx.req.text(); // Get text body
await ctx.req.formData(); // Parse form data

// Response helpers
ctx.json(data, status); // JSON response
ctx.text(text, status); // Text response
ctx.html(html, status); // HTML response
ctx.redirect(url, status); // Redirect response

// State management
ctx.set("key", value); // Set context value
ctx.get("key"); // Get context value

// Environment
ctx.env; // Environment variables
ctx.executionCtx; // Execution context (for edge runtimes)
```

## Best Practices

1. **Order matters** - Add middleware in the correct order:
   - Error handler (first)
   - Logger
   - CORS
   - Security headers
   - Compression
   - Rate limiter
   - Auth
   - Your routes (last)

2. **Always call next()** unless you're intentionally stopping the pipeline

3. **Use middleware factories** for configurable middleware

4. **Handle errors** - Use try/catch or error handler middleware

5. **Keep middleware focused** - Each middleware should do one thing well

## Performance Tips

- Add compression middleware for large responses
- Use rate limiting to prevent abuse
- Cache middleware results when possible
- Avoid heavy synchronous operations
- Use streaming for large file responses

## Related Modules

- **#server** - Server implementation using middleware
- **#api** - API routes with middleware support
- **#security** - Additional security utilities

## References

- [Hono Documentation](https://hono.dev/) - Inspiration for middleware design
