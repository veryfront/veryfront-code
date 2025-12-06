---
title: Cloudflare Workers Deployment
description: Deploy Veryfront applications to Cloudflare Workers for global edge deployment
keywords:
  - Cloudflare Workers
  - edge deployment
  - serverless
  - CDN
  - global distribution
  - Workers KV
  - Cloudflare Pages
related:
  - /docs/guides/deployment/node.md
  - /docs/guides/deployment/bun.md
  - /docs/guides/performance/optimization.md
  - /docs/guides/performance/caching.md
---

# Cloudflare Workers Deployment

Deploy Veryfront applications to Cloudflare's global edge network for ultra-low latency, automatic scaling, and serverless execution.

## Overview

Cloudflare Workers run your code at the edge, close to users worldwide, providing:

**Key Advantages:**
- **Global Edge Network**: Deploy to 275+ cities worldwide
- **Zero Cold Starts**: Sub-millisecond startup
- **Automatic Scaling**: Handle millions of requests
- **Pay-Per-Use**: Only pay for what you use
- **Integrated Services**: KV storage, R2 objects, D1 databases
- **Built-in DDoS Protection**: Enterprise-grade security

## Prerequisites

### Install Wrangler CLI

```bash
# Install Wrangler (Cloudflare Workers CLI)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Verify installation
wrangler --version
```

### Cloudflare Account

1. Sign up at [cloudflare.com](https://cloudflare.com)
2. Verify email address
3. Get your Account ID from dashboard

## Project Setup

### 1. Create wrangler.toml

```toml
# wrangler.toml
name = "veryfront-app"
main = "worker.ts"
compatibility_date = "2024-01-01"

# Account Configuration
account_id = "your-account-id"
workers_dev = true

# Environment Variables
[vars]
ENVIRONMENT = "production"
APP_URL = "https://example.com"

# KV Namespaces (for caching/session storage)
[[kv_namespaces]]
binding = "CACHE"
id = "your-kv-namespace-id"

# R2 Buckets (for object storage)
[[r2_buckets]]
binding = "ASSETS"
bucket_name = "veryfront-assets"

# D1 Databases (for SQL storage)
[[d1_databases]]
binding = "DB"
database_name = "veryfront-db"
database_id = "your-d1-database-id"

# Custom Domain
routes = [
  { pattern = "example.com/*", zone_name = "example.com" }
]
```

### 2. Create Worker Entry Point

```typescript
// worker.ts
import { handler } from './.veryfront/build/server/index.js';

export interface Env {
  CACHE: KVNamespace;
  ASSETS: R2Bucket;
  DB: D1Database;
  ENVIRONMENT: string;
  APP_URL: string;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      // Serve static assets from R2
      if (url.pathname.startsWith('/_veryfront/')) {
        const object = await env.ASSETS.get(url.pathname);

        if (object) {
          return new Response(object.body, {
            headers: {
              'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable',
              'ETag': object.httpEtag,
            },
          });
        }
      }

      // Check KV cache
      const cacheKey = `cache:${url.pathname}`;
      const cached = await env.CACHE.get(cacheKey);

      if (cached) {
        return new Response(cached, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'X-Cache': 'HIT',
          },
        });
      }

      // Handle dynamic request
      const response = await handleDynamicRequest(request, handler, env);

      // Cache successful responses
      if (response.ok) {
        ctx.waitUntil(
          env.CACHE.put(cacheKey, await response.clone().text(), {
            expirationTtl: 3600, // 1 hour
          })
        );
      }

      return response;
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

// Helper to adapt Veryfront handler
async function handleDynamicRequest(
  request: Request,
  handler: any,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // Create Node.js-compatible request object
  const nodeReq = {
    method: request.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(request.headers.entries()),
  };

  let statusCode = 200;
  const headers = new Headers();
  let body = '';

  const nodeRes = {
    statusCode,
    setHeader: (key: string, value: string) => headers.set(key, value),
    writeHead: (code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      if (hdrs) {
        Object.entries(hdrs).forEach(([k, v]) => headers.set(k, v));
      }
    },
    write: (chunk: string) => { body += chunk; },
    end: (chunk?: string) => {
      if (chunk) body += chunk;
    },
  };

  // Make env available to handlers
  (nodeReq as any).env = env;

  await handler(nodeReq, nodeRes);

  return new Response(body, {
    status: statusCode,
    headers,
  });
}
```

## Build for Workers

### 1. Build Application

```bash
# Build Veryfront app
veryfront build

# Output: .veryfront/build/
```

### 2. Upload Assets to R2

```bash
# Create R2 bucket
wrangler r2 bucket create veryfront-assets

# Upload client assets
wrangler r2 object put veryfront-assets/_veryfront/main.js \
  --file .veryfront/build/client/assets/main.js \
  --content-type application/javascript

# Or use rclone for bulk upload
rclone sync .veryfront/build/client/ cloudflare:veryfront-assets/
```

## Deploy to Workers

### Development Deployment

```bash
# Deploy to workers.dev subdomain
wrangler deploy

# View deployment
# https://veryfront-app.your-subdomain.workers.dev
```

### Production Deployment

```bash
# Deploy with custom domain
wrangler deploy --env production

# View logs
wrangler tail

# View metrics
wrangler deployments list
```

## Environment Configuration

### Environment Variables

```toml
# wrangler.toml

# Development Environment
[env.development]
name = "veryfront-app-dev"
vars = { ENVIRONMENT = "development" }

# Staging Environment
[env.staging]
name = "veryfront-app-staging"
vars = { ENVIRONMENT = "staging" }

# Production Environment
[env.production]
name = "veryfront-app-prod"
vars = { ENVIRONMENT = "production" }
routes = [
  { pattern = "example.com/*", zone_name = "example.com" }
]
```

### Secrets Management

```bash
# Set secrets (encrypted environment variables)
wrangler secret put API_KEY
wrangler secret put DATABASE_URL
wrangler secret put SECRET_KEY

# List secrets
wrangler secret list

# Delete secret
wrangler secret delete API_KEY
```

## Workers KV (Key-Value Storage)

### Create KV Namespace

```bash
# Create production KV namespace
wrangler kv:namespace create "CACHE"

# Create preview KV namespace (for development)
wrangler kv:namespace create "CACHE" --preview

# Add to wrangler.toml
# [[kv_namespaces]]
# binding = "CACHE"
# id = "your-kv-namespace-id"
# preview_id = "your-preview-id"
```

### Use KV in Worker

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    // Read from KV
    const value = await env.CACHE.get('key');

    // Write to KV
    await env.CACHE.put('key', 'value', {
      expirationTtl: 3600, // Expires in 1 hour
    });

    // Delete from KV
    await env.CACHE.delete('key');

    // List keys
    const keys = await env.CACHE.list();

    return new Response('OK');
  },
};
```

## Workers R2 (Object Storage)

### Create R2 Bucket

```bash
# Create bucket
wrangler r2 bucket create veryfront-assets

# List buckets
wrangler r2 bucket list

# Add to wrangler.toml
# [[r2_buckets]]
# binding = "ASSETS"
# bucket_name = "veryfront-assets"
```

### Use R2 in Worker

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    // Upload object
    await env.ASSETS.put('images/logo.png', file, {
      httpMetadata: {
        contentType: 'image/png',
      },
    });

    // Download object
    const object = await env.ASSETS.get('images/logo.png');
    if (object) {
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
        },
      });
    }

    // Delete object
    await env.ASSETS.delete('images/logo.png');

    // List objects
    const list = await env.ASSETS.list({ prefix: 'images/' });

    return new Response('OK');
  },
};
```

## D1 Database (SQL)

### Create D1 Database

```bash
# Create database
wrangler d1 create veryfront-db

# Add to wrangler.toml
# [[d1_databases]]
# binding = "DB"
# database_name = "veryfront-db"
# database_id = "your-database-id"

# Execute SQL
wrangler d1 execute veryfront-db --file=schema.sql

# Query database
wrangler d1 execute veryfront-db --command="SELECT * FROM users"
```

### Use D1 in Worker

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    // Query database
    const result = await env.DB.prepare(
      'SELECT * FROM users WHERE id = ?'
    ).bind(1).first();

    // Insert data
    await env.DB.prepare(
      'INSERT INTO users (name, email) VALUES (?, ?)'
    ).bind('John', 'john@example.com').run();

    // Transaction
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users (name) VALUES (?)').bind('Alice'),
      env.DB.prepare('INSERT INTO users (name) VALUES (?)').bind('Bob'),
    ]);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
```

## Custom Domains & SSL

### Add Custom Domain

```bash
# Add route in wrangler.toml
# routes = [
#   { pattern = "example.com/*", zone_name = "example.com" }
# ]

# Deploy with custom domain
wrangler deploy

# SSL is automatically provisioned by Cloudflare
```

### Multiple Domains

```toml
# wrangler.toml
routes = [
  { pattern = "example.com/*", zone_name = "example.com" },
  { pattern = "www.example.com/*", zone_name = "example.com" },
  { pattern = "api.example.com/*", zone_name = "example.com" },
]
```

## Caching Strategies

### Cache API

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);

    // Check cache
    let response = await cache.match(cacheKey);

    if (!response) {
      // Generate response
      response = await handleRequest(request);

      // Cache response
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    }

    return response;
  },
};
```

### Cache Headers

```typescript
// Set cache headers
const response = new Response(body, {
  headers: {
    'Cache-Control': 'public, max-age=3600',
    'CDN-Cache-Control': 'max-age=86400',
  },
});
```

## Monitoring and Logging

### View Logs

```bash
# Tail logs in real-time
wrangler tail

# Filter logs
wrangler tail --status error
wrangler tail --method POST

# View specific deployment
wrangler tail --env production
```

### Add Logging

```typescript
// worker.ts
export default {
  async fetch(request: Request, env: Env) {
    const start = Date.now();
    const url = new URL(request.url);

    try {
      const response = await handleRequest(request);

      console.log(JSON.stringify({
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration: Date.now() - start,
      }));

      return response;
    } catch (error) {
      console.error('Error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};
```

### Analytics

```typescript
// Track analytics
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const response = await handleRequest(request);

    // Send analytics (non-blocking)
    ctx.waitUntil(
      fetch('https://analytics.example.com/track', {
        method: 'POST',
        body: JSON.stringify({
          path: new URL(request.url).pathname,
          status: response.status,
          country: request.cf?.country,
          colo: request.cf?.colo,
        }),
      })
    );

    return response;
  },
};
```

## CI/CD Integration

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build application
        run: npm run build

      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

### GitLab CI

```yaml
# .gitlab-ci.yml
deploy:
  stage: deploy
  image: node:18
  script:
    - npm ci
    - npm run build
    - npx wrangler deploy
  only:
    - main
  variables:
    CLOUDFLARE_API_TOKEN: $CLOUDFLARE_API_TOKEN
    CLOUDFLARE_ACCOUNT_ID: $CLOUDFLARE_ACCOUNT_ID
```

## Deployment Checklist

### Pre-Deployment

- [ ] Install Wrangler CLI: `npm install -g wrangler`
- [ ] Login to Cloudflare: `wrangler login`
- [ ] Create `wrangler.toml` configuration
- [ ] Build application: `veryfront build`
- [ ] Upload assets to R2
- [ ] Create KV namespaces
- [ ] Set up D1 database (if needed)
- [ ] Configure environment variables

### Security

- [ ] Set secrets with `wrangler secret put`
- [ ] Configure CORS policies
- [ ] Enable rate limiting
- [ ] Set security headers
- [ ] Configure WAF rules in Cloudflare dashboard

### Optimization

- [ ] Enable caching with Cache API
- [ ] Use KV for session storage
- [ ] Optimize bundle size (< 1MB)
- [ ] Use waitUntil for non-blocking operations
- [ ] Configure cache headers

### Post-Deployment

- [ ] Test deployed application
- [ ] Monitor logs: `wrangler tail`
- [ ] Check analytics in Cloudflare dashboard
- [ ] Set up custom domain
- [ ] Configure DNS records

## Best Practices

### 1. Use Edge-Optimized Patterns

```typescript
// ✅ Good: Use edge caching
const cached = await caches.default.match(request);

// ✅ Good: Use KV for session data
const session = await env.CACHE.get(`session:${userId}`);

// ❌ Bad: Long-running computations (CPU time limit)
for (let i = 0; i < 1000000; i++) { /* ... */ }
```

### 2. Optimize Bundle Size

```typescript
// ✅ Good: Dynamic imports
const module = await import('./heavy-module.js');

// ✅ Good: Tree-shaking friendly imports
import { specific } from 'library';

// ❌ Bad: Import entire library
import _ from 'lodash';
```

### 3. Handle Errors Gracefully

```typescript
// ✅ Good: Proper error handling
try {
  const response = await handleRequest(request);
  return response;
} catch (error) {
  console.error('Error:', error);
  return new Response('Error', { status: 500 });
}
```

## Troubleshooting

### Script Size Too Large

```bash
# Check bundle size
wrangler deploy --dry-run --outdir=dist

# Optimize bundle
# - Use dynamic imports
# - Remove unused dependencies
# - Enable tree-shaking
```

### CPU Time Exceeded

```typescript
// Solution: Use waitUntil for non-blocking work
ctx.waitUntil(heavyOperation());

// Solution: Break work into smaller chunks
// Process in multiple requests if needed
```

### KV Not Working

```bash
# Verify KV namespace ID in wrangler.toml
wrangler kv:namespace list

# Check binding name matches
# [[kv_namespaces]]
# binding = "CACHE"  # Use env.CACHE in code
```

## Cloudflare Pages Alternative

For static sites or apps with minimal server logic:

```bash
# Deploy to Cloudflare Pages
npx wrangler pages deploy .veryfront/build

# Configure Pages Functions
# _worker.js in output directory
```

## Next Steps

- Compare with [Node.js deployment](/guides/deployment/node.md)
- Explore [Bun deployment](/guides/deployment/bun.md) for faster runtime
- Read [Performance Optimization](/guides/performance/optimization.md)
- Check [Caching Strategies](/guides/performance/caching.md)
