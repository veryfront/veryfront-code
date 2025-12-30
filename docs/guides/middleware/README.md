---
title: "Middleware Guide"
category: "guides"
level: "intermediate"
keywords: ["middleware", "security", "headers", "cors", "rate-limiting", "csp", "csrf"]
ai_summary: "Guide to using and configuring middleware in Veryfront, including security features like CSP, CORS, CSRF, and Rate Limiting."
related: ["reference/configuration/README", "api/README"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Middleware Guide

Middleware allows you to intercept and modify requests and responses. Veryfront provides a robust middleware system with built-in security features.

## Built-in Middleware

Veryfront comes with several built-in middleware for common security tasks.

### Rate Limiting

Protect your application from abuse with the rate limiting middleware.

**Features:**
- Configurable window and limit
- Pluggable storage backend (Memory, Redis)
- Custom key generation (IP, API Key, etc.)

**Basic Usage:**

```typescript
import { rateLimit } from 'veryfront/middleware';

// Limit to 100 requests per minute per IP (default)
export const middleware = [
  rateLimit(),
];
```

**Custom Configuration:**

```typescript
import { rateLimit } from 'veryfront/middleware';

// Limit to 50 requests per hour
export const middleware = [
  rateLimit({
    maxRequests: 50,
    windowMs: 60 * 60 * 1000, // 1 hour
  }),
];
```

**Distributed Rate Limiting (Redis):**

For production environments with multiple server instances, use the Redis backend to share rate limit state.

```typescript
import { rateLimit } from 'veryfront/middleware';
import { RedisRateLimitStore } from 'veryfront/middleware/redis-rate-limit';

export const middleware = [
  rateLimit({
    store: new RedisRateLimitStore({
      url: getEnv('REDIS_URL'),
    }),
  }),
];
```

### Security Headers (CSP, HSTS, etc.)

Set standard security headers to protect your users.

```typescript
import { securityHeaders } from 'veryfront/middleware';

export const middleware = [
  securityHeaders({
    contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
    hsts: { maxAge: 31536000, includeSubDomains: true },
    frameOptions: "DENY",
  }),
];
```

### CORS (Cross-Origin Resource Sharing)

Configure CORS policies for your API.

```typescript
import { cors } from 'veryfront/middleware';

export const middleware = [
  cors({
    origin: ['https://example.com', 'https://admin.example.com'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  }),
];
```

### CSRF Protection

Protect against Cross-Site Request Forgery attacks.

```typescript
import { csrf } from 'veryfront/middleware';

export const middleware = [
  csrf({
    cookieName: '__Host-csrf',
    ignoreMethods: ['GET', 'HEAD', 'OPTIONS'],
  }),
];
```

### Logger

Log request/response information with customizable formatting.

**Basic Usage:**

```typescript
import { logger } from 'veryfront/middleware';

export const middleware = [
  logger(), // Default logging
];
```

**Environment-Specific Loggers:**

```typescript
import { devLogger, prodLogger } from 'veryfront/middleware';

// Development: verbose, colorized output
export const middleware = [
  devLogger(),
];

// Production: JSON format for log aggregation
export const middleware = [
  prodLogger(),
];
```

**Custom Configuration:**

```typescript
import { logger } from 'veryfront/middleware';

export const middleware = [
  logger({
    format: 'combined', // 'dev', 'combined', 'short', 'tiny'
    skip: (ctx) => ctx.request.url.includes('/health'),
  }),
];
```

## Creating Custom Middleware

You can create your own middleware functions. A middleware is a function that takes a `context` and a `next` function.

```typescript
import type { Middleware } from 'veryfront/middleware';

export const myLogger: Middleware = async (ctx, next) => {
  const start = Date.now();
  
  // Process request
  const response = await next();
  
  // Process response
  const ms = Date.now() - start;
  console.log(`${ctx.request.method} ${ctx.request.url} - ${ms}ms`);
  
  return response;
};
```

## Middleware Pipeline

Middleware is executed in the order defined in your `middleware.ts` file or configuration.

```typescript
// middleware.ts
import { rateLimit, cors, securityHeaders } from 'veryfront/middleware';
import { myLogger } from './utils/logger';

export default [
  myLogger,        // Run first
  rateLimit(),     // Check limits
  cors(),          // Check CORS
  securityHeaders(), // Add headers
];
```
