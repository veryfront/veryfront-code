---
title: Bun Deployment
description: Deploy Veryfront applications to Bun runtime for maximum performance
keywords:
  - Bun deployment
  - Bun runtime
  - fast deployment
  - production Bun
  - Bun server
  - performance optimization
related:
  - /docs/guides/deployment/node.md
  - /docs/guides/deployment/cloudflare.md
  - /docs/guides/performance/optimization.md
---

# Bun Deployment

Deploy Veryfront applications to Bun runtime for exceptional performance, fast startup times, and native TypeScript support.

## Overview

Bun is a fast all-in-one JavaScript runtime & toolkit designed for speed with a clean API and excellent developer experience.

**Key Advantages:**
- **Fast Startup**: faster than Node.js
- **Native TypeScript**: No transpilation needed
- **Built-in Bundler**: No separate build step
- **Better Performance**: Optimized for production workloads
- **Drop-in Replacement**: Compatible with Node.js APIs
- **Built-in Tools**: Test runner, package manager, bundler

## Prerequisites

### Install Bun

```bash
# macOS/Linux
curl -fsSL https://bun.sh/install | bash

# Windows (WSL recommended)
npm install -g bun

# Verify installation
bun --version  # 1.0.0+
```

### System Requirements

- Bun 1.0.0 or later
- Linux (recommended), macOS, or WSL on Windows
- 64-bit architecture

## Build for Production

### 1. Build Your Application

```bash
# Build with veryfront CLI
veryfront build

# Output: .veryfront/build/
```

### 2. Create Production Server

```typescript
// server.ts
import { serve } from 'bun';
import { handler } from './.veryfront/build/server/index.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Bun's high-performance HTTP server
serve({
  port: PORT,
  hostname: HOST,

  async fetch(req) {
    try {
      // Create Node.js-compatible request/response objects
      const url = new URL(req.url);

      // Simple adapter for Bun Request -> Node Request
      const nodeReq = {
        method: req.method,
        url: url.pathname + url.search,
        headers: Object.fromEntries(req.headers.entries()),
      };

      // Response object
      let statusCode = 200;
      let headers = new Headers();
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

      // Handle request
      await handler(nodeReq as any, nodeRes as any);

      return new Response(body, {
        status: statusCode,
        headers,
      });
    } catch (error) {
      console.error('Request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  error(error) {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(` Server running at http://${HOST}:${PORT}`);
```

### 3. Start Production Server

```bash
# Start server with Bun
bun run server.ts

# With environment variables
PORT=3000 HOST=0.0.0.0 bun run server.ts
```

## Optimized Bun Server

### High-Performance Server

```typescript
// server.ts
import { serve, file } from 'bun';
import { handler } from './.veryfront/build/server/index.js';
import { join } from 'node:path';

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';
const CLIENT_DIR = join(process.cwd(), '.veryfront/build/client');
const STATIC_DIR = join(process.cwd(), '.veryfront/build/static');

serve({
  port: PORT,
  hostname: HOST,
  development: false,

  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    try {
      // Serve static client assets with Bun's optimized file()
      if (pathname.startsWith('/_veryfront/')) {
        const filePath = join(CLIENT_DIR, pathname.replace('/_veryfront/', ''));
        const staticFile = file(filePath);

        if (await staticFile.exists()) {
          return new Response(staticFile, {
            headers: {
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
        }
      }

      // Serve public static files
      if (pathname.startsWith('/public/')) {
        const filePath = join(STATIC_DIR, pathname);
        const staticFile = file(filePath);

        if (await staticFile.exists()) {
          return new Response(staticFile, {
            headers: {
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
        }
      }

      // Handle dynamic requests with Veryfront handler
      return await handleDynamicRequest(req, handler);
    } catch (error) {
      console.error('Request error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },

  error(error) {
    console.error('Server error:', error);
    return new Response('Internal Server Error', { status: 500 });
  },
});

console.log(` Bun server running at http://${HOST}:${PORT}`);

// Helper to adapt handler
async function handleDynamicRequest(req: Request, handler: any) {
  const url = new URL(req.url);

  const nodeReq = {
    method: req.method,
    url: url.pathname + url.search,
    headers: Object.fromEntries(req.headers.entries()),
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

  await handler(nodeReq, nodeRes);

  return new Response(body, {
    status: statusCode,
    headers,
  });
}
```

## Environment Variables

### .env.production

```bash
# .env.production

# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Application
APP_URL=https://example.com

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# API Keys
API_KEY=your-api-key
SECRET_KEY=your-secret-key

# Redis
REDIS_URL=redis://localhost:6379
```

### Load Environment Variables

```typescript
// Bun has built-in .env support
// Just run: bun run server.ts

// Or manually load
import { config } from 'dotenv';
config({ path: '.env.production' });

const PORT = process.env.PORT || 3000;
```

## Process Management

### Using systemd

```ini
# /etc/systemd/system/veryfront-app.service
[Unit]
Description=Veryfront Application
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/veryfront-app
ExecStart=/usr/local/bin/bun run server.ts
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable veryfront-app
sudo systemctl start veryfront-app

# View status
sudo systemctl status veryfront-app

# View logs
sudo journalctl -u veryfront-app -f
```

### Using PM2 with Bun

```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start server.ts --interpreter bun --name veryfront-app

# PM2 ecosystem file
# ecosystem.config.js
module.exports = {
  apps: [{
    name: 'veryfront-app',
    script: './server.ts',
    interpreter: 'bun',
    instances: 1,  # Bun doesn't support cluster mode yet
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};

# Start with config
pm2 start ecosystem.config.js
```

## Docker Deployment

### Dockerfile for Bun

```dockerfile
# Dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production

# Build stage
FROM base AS builder
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 bunjs
RUN adduser --system --uid 1001 veryfront

# Copy built application
COPY --from=builder --chown=veryfront:bunjs /app/.veryfront/build ./.veryfront/build
COPY --from=builder --chown=veryfront:bunjs /app/server.ts ./
COPY --from=deps --chown=veryfront:bunjs /app/node_modules ./node_modules

USER veryfront

EXPOSE 3000

CMD ["bun", "run", "server.ts"]
```

### docker-compose.yml

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/mydb
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

### Build and Run

```bash
# Build image
docker build -t veryfront-bun .

# Run container
docker run -p 3000:3000 veryfront-bun

# With docker-compose
docker-compose up -d

# View logs
docker-compose logs -f app
```

## nginx Reverse Proxy

### nginx Configuration

```nginx
# /etc/nginx/sites-available/veryfront-bun

upstream bun_app {
  server 127.0.0.1:3000;
  keepalive 64;
}

server {
  listen 80;
  server_name example.com;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name example.com;

  # SSL Configuration
  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;

  # Security Headers
  add_header Strict-Transport-Security "max-age=31536000" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;

  # Gzip
  gzip on;
  gzip_vary on;
  gzip_min_length 1024;
  gzip_types text/plain text/css application/javascript application/json;

  # Static files
  location /_veryfront/ {
    alias /var/www/veryfront-app/.veryfront/build/client/;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Proxy to Bun
  location / {
    proxy_pass http://bun_app;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
  }
}
```

## Performance Optimization

### Built-in Optimizations

Bun provides automatic optimizations:

```typescript
// server.ts
import { serve } from 'bun';

serve({
  // Bun automatically:
  // - Uses optimized HTTP parser
  // - Enables HTTP/2 and HTTP/3
  // - Handles compression efficiently
  // - Optimizes static file serving

  development: false,  // Production optimizations

  async fetch(req) {
    // Your handler
  },
});
```

### Static File Caching

```typescript
import { serve, file } from 'bun';

serve({
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files with Bun's optimized file()
    if (url.pathname.startsWith('/_veryfront/')) {
      const staticFile = file(`.veryfront/build/client${url.pathname}`);

      if (await staticFile.exists()) {
        return new Response(staticFile, {
          headers: {
            'Cache-Control': 'public, max-age=31536000, immutable',
            // Bun automatically sets Content-Type
          },
        });
      }
    }

    // Dynamic handler
    return handleRequest(req);
  },
});
```

## Monitoring and Logging

### Health Check

```typescript
// server.ts
import { serve } from 'bun';

serve({
  async fetch(req) {
    const url = new URL(req.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'healthy',
        runtime: 'bun',
        version: Bun.version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Normal request handling
    return handleRequest(req);
  },
});
```

### Structured Logging

```typescript
// logger.ts
export const logger = {
  info: (message: string, meta?: any) => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      ...meta,
      timestamp: new Date().toISOString(),
    }));
  },

  error: (message: string, error?: Error, meta?: any) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error?.message,
      stack: error?.stack,
      ...meta,
      timestamp: new Date().toISOString(),
    }));
  },
};

// Usage in server
import { logger } from './logger';

serve({
  async fetch(req) {
    const start = Date.now();
    const url = new URL(req.url);

    try {
      const response = await handleRequest(req);

      logger.info('Request completed', {
        method: req.method,
        path: url.pathname,
        status: response.status,
        duration: Date.now() - start,
      });

      return response;
    } catch (error) {
      logger.error('Request failed', error as Error, {
        method: req.method,
        path: url.pathname,
      });

      return new Response('Internal Server Error', { status: 500 });
    }
  },
});
```

## Database Connections

### PostgreSQL with Bun

```typescript
// db.ts
import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end();
  process.exit(0);
});
```

### Redis with Bun

```typescript
// redis.ts
import { createClient } from 'redis';

export const redis = createClient({
  url: process.env.REDIS_URL,
});

await redis.connect();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
  process.exit(0);
});
```

## Deployment Checklist

### Pre-Deployment

- [ ] Install Bun on server: `curl -fsSL https://bun.sh/install | bash`
- [ ] Build application: `veryfront build`
- [ ] Test locally: `bun run server.ts`
- [ ] Set environment variables in `.env.production`
- [ ] Configure database connections
- [ ] Set up SSL certificates
- [ ] Configure nginx reverse proxy

### Production Optimization

- [ ] Set `development: false` in Bun server
- [ ] Enable static file caching
- [ ] Configure health check endpoint
- [ ] Set up logging and monitoring
- [ ] Configure graceful shutdown
- [ ] Test with production load

### Security

- [ ] Enable HTTPS/SSL
- [ ] Set secure environment variables
- [ ] Configure CORS policies
- [ ] Enable rate limiting via nginx
- [ ] Set security headers
- [ ] Update dependencies: `bun update`

## Bun vs Node.js Performance

### Startup Time

```bash
# Bun: ~50ms
time bun run server.ts

# Node.js: ~150ms
time node server.js

# Bun is ~3x faster startup
```

### Request Throughput

Bun's HTTP server is optimized for high throughput:
- **Node.js**: ~50,000 req/s
- **Bun**: ~150,000 req/s
- **improved performance** for HTTP workloads

### Memory Usage

Bun uses less memory:
- **Node.js**: ~80MB baseline
- **Bun**: ~30MB baseline
- **reduced memory usage** consumption

## Best Practices

### 1. Use Bun's Native APIs

```typescript
// ✅ Good: Use Bun's optimized file()
import { file } from 'bun';
const staticFile = file('./public/image.jpg');

// ❌ Bad: Use Node.js fs
import { readFileSync } from 'node:fs';
const data = readFileSync('./public/image.jpg');
```

### 2. Enable Production Mode

```typescript
// ✅ Good: Disable development mode
serve({
  development: false,
  fetch(req) { /* ... */ },
});

// ❌ Bad: Leave development enabled
serve({
  development: true,  // Slower in production
  fetch(req) { /* ... */ },
});
```

### 3. Leverage Built-in Performance

```typescript
// ✅ Good: Let Bun handle optimization
serve({
  fetch(req) {
    // Bun optimizes automatically
    return new Response(file('./static/file.js'));
  },
});
```

## Troubleshooting

### Bun Not Found

```bash
# Add Bun to PATH
export PATH="$HOME/.bun/bin:$PATH"

# Reload shell
source ~/.bashrc  # or ~/.zshrc
```

### Port Permission Denied

```bash
# Allow Bun to bind to privileged ports
sudo setcap 'cap_net_bind_service=+ep' $(which bun)
```

### Module Not Found

```bash
# Reinstall dependencies with Bun
bun install

# Clear cache
rm -rf node_modules .bun bun.lockb
bun install
```

## Migration from Node.js

### 1. Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Replace Node.js Commands

```bash
# Before (Node.js)
npm install
npm run build
node server.js

# After (Bun)
bun install
bun run build
bun run server.ts
```

### 3. Update Server Code

Replace Node.js HTTP server with Bun's `serve()`:

```typescript
// Before (Node.js)
import { createServer } from 'node:http';
createServer(handler).listen(3000);

// After (Bun)
import { serve } from 'bun';
serve({ port: 3000, fetch: handler });
```

## Next Steps

- Compare with [Node.js deployment](/guides/deployment/node.md)
- Explore [Cloudflare Workers](/guides/deployment/cloudflare.md) for edge
- Read [Performance Optimization](/guides/performance/optimization.md)
- Check [Caching Strategies](/guides/performance/caching.md)
