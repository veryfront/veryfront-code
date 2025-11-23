---
title: Node.js Deployment
description: Deploy Veryfront applications to Node.js production environments
keywords:
  - Node.js deployment
  - production deployment
  - server setup
  - environment variables
  - process management
  - PM2
  - clustering
  - docker
  - nginx
related:
  - /docs/guides/deployment/bun.md
  - /docs/guides/deployment/cloudflare.md
  - /docs/guides/performance/optimization.md
  - /docs/guides/performance/caching.md
---

# Node.js Deployment

Deploy Veryfront applications to production Node.js environments with optimal performance, security, and reliability.

## Overview

- **Runtime Support**: Node.js 18+ (LTS recommended)
- **Process Management**: PM2, systemd, or Docker
- **Clustering**: Multi-core CPU utilization
- **Reverse Proxy**: nginx or Caddy
- **SSL/TLS**: Let's Encrypt or custom certificates
- **Monitoring**: Built-in health checks and metrics

## Prerequisites

### System Requirements

```bash
# Node.js 18+ (LTS recommended)
node --version  # v18.0.0+

# npm or yarn
npm --version   # 9.0.0+

# Optional: PM2 for process management
npm install -g pm2

# Optional: nginx for reverse proxy
nginx -v
```

## Build for Production

### 1. Build Your Application

```bash
# Build the application
veryfront build
```

## Production Server Setup

### Node.js Server

```javascript
// server.js
import { createServer } from 'node:http';
import { handler } from './.veryfront/build/server/index.js';

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    console.error('Request error:', error);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
```

### Start the Server

```bash
# Start production server
NODE_ENV=production node server.js

# With environment variables
PORT=3000 HOST=0.0.0.0 NODE_ENV=production node server.js
```

## Environment Variables

### Create .env.production

```bash
# .env.production

# Server Configuration
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Application URL
APP_URL=https://example.com

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/mydb

# API Keys
API_KEY=your-api-key
SECRET_KEY=your-secret-key

# Redis (for caching)
REDIS_URL=redis://localhost:6379

# Monitoring
LOG_LEVEL=info
SENTRY_DSN=your-sentry-dsn
```

### Load Environment Variables

```javascript
// server.js
import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.production') });

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
```

## Process Management with PM2

### Install PM2

```bash
# Install PM2 globally
npm install -g pm2

# Verify installation
pm2 --version
```

### PM2 Configuration

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'veryfront-app',
    script: './server.js',
    instances: 'max',  // Use all CPU cores
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
  }],
};
```

### PM2 Commands

```bash
# Start application
pm2 start ecosystem.config.js

# Stop application
pm2 stop veryfront-app

# Restart application
pm2 restart veryfront-app

# Reload (zero-downtime)
pm2 reload veryfront-app

# View logs
pm2 logs veryfront-app

# Monitor
pm2 monit

# List processes
pm2 list

# Save process list
pm2 save

# Startup script (run on boot)
pm2 startup
```

### PM2 with TypeScript

```javascript
// ecosystem.config.js for TypeScript
module.exports = {
  apps: [{
    name: 'veryfront-app',
    script: 'tsx',
    args: 'server.ts',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
```

## Clustering for Multi-Core

### Manual Clustering

```javascript
// server-cluster.js
import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { createServer } from 'node:http';
import { handler } from './.veryfront/build/server/index.js';

const numCPUs = cpus().length;
const PORT = process.env.PORT || 3000;

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  console.log(`Forking ${numCPUs} workers...`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  // Workers share the TCP connection
  const server = createServer(handler);

  server.listen(PORT, () => {
    console.log(`Worker ${process.pid} started`);
  });
}
```

## Reverse Proxy with nginx

### Install nginx

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install nginx

# macOS
brew install nginx

# Start nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

### nginx Configuration

```nginx
# /etc/nginx/sites-available/veryfront-app

upstream veryfront_app {
  # Load balancing across multiple Node.js instances
  server 127.0.0.1:3000;
  server 127.0.0.1:3001;
  server 127.0.0.1:3002;

  # Load balancing method
  least_conn;

  # Health checks
  keepalive 64;
}

server {
  listen 80;
  server_name example.com www.example.com;

  # Redirect HTTP to HTTPS
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name example.com www.example.com;

  # SSL Configuration
  ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  # Security Headers
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header X-XSS-Protection "1; mode=block" always;

  # Gzip Compression
  gzip on;
  gzip_vary on;
  gzip_min_length 1024;
  gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml+rss;

  # Static Files
  location /_veryfront/ {
    alias /var/www/veryfront-app/.veryfront/build/client/;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  location /public/ {
    alias /var/www/veryfront-app/.veryfront/build/static/public/;
    expires 1y;
    add_header Cache-Control "public, immutable";
  }

  # Proxy to Node.js
  location / {
    proxy_pass http://veryfront_app;
    proxy_http_version 1.1;

    # Proxy headers
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_cache_bypass $http_upgrade;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;
  }

  # Health Check Endpoint
  location /health {
    proxy_pass http://veryfront_app/health;
    access_log off;
  }
}
```

### Enable nginx Site

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/veryfront-app /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## SSL/TLS with Let's Encrypt

### Install Certbot

```bash
# Ubuntu/Debian
sudo apt install certbot python3-certbot-nginx

# macOS
brew install certbot
```

### Obtain SSL Certificate

```bash
# Automatic nginx configuration
sudo certbot --nginx -d example.com -d www.example.com

# Manual certificate only
sudo certbot certonly --nginx -d example.com

# Test auto-renewal
sudo certbot renew --dry-run
```

### Auto-Renewal Cron Job

```bash
# Add to crontab
crontab -e

# Run renewal check twice daily
0 0,12 * * * certbot renew --quiet
```

## Docker Deployment

### Dockerfile

```dockerfile
# Dockerfile
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Build stage
FROM base AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 veryfront

# Copy built application
COPY --from=builder --chown=veryfront:nodejs /app/.veryfront/build ./.veryfront/build
COPY --from=builder --chown=veryfront:nodejs /app/server.js ./
COPY --from=deps --chown=veryfront:nodejs /app/node_modules ./node_modules

USER veryfront

EXPOSE 3000

CMD ["node", "server.js"]
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
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  db:
    image: postgres:15-alpine
    environment:
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=mydb
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Docker Commands

```bash
# Build image
docker build -t veryfront-app .

# Run container
docker run -p 3000:3000 veryfront-app

# Run with docker-compose
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop containers
docker-compose down

# Rebuild and restart
docker-compose up -d --build
```

## Health Checks

### Health Check Endpoint

```typescript
// server.ts
import { createServer } from 'node:http';
import { handler } from './.veryfront/build/server/index.js';

const server = createServer(async (req, res) => {
  // Health check endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  // Normal request handling
  await handler(req, res);
});
```

## Logging and Monitoring

### Winston Logger

```bash
# Install Winston
npm install winston
```

```javascript
// logger.js
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple(),
  }));
}
```

### Use Logger in Server

```javascript
// server.js
import { logger } from './logger.js';

const server = createServer(async (req, res) => {
  const start = Date.now();

  try {
    await handler(req, res);

    const duration = Date.now() - start;
    logger.info('Request processed', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
    });
  } catch (error) {
    logger.error('Request failed', {
      method: req.method,
      url: req.url,
      error: error.message,
      stack: error.stack,
    });
  }
});
```

### Sentry Integration

```bash
# Install Sentry
npm install @sentry/node
```

```javascript
// server.js
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 1.0,
});

const server = createServer(async (req, res) => {
  try {
    await handler(req, res);
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }
});
```

## Performance Optimization

### Enable Compression

```javascript
// server.js
import compression from 'compression';
import { createServer } from 'node:http';

const compress = compression();

const server = createServer((req, res) => {
  compress(req, res, async () => {
    await handler(req, res);
  });
});
```

### Static Asset Caching

```javascript
// server.js
const server = createServer(async (req, res) => {
  // Cache static assets for 1 year
  if (req.url?.startsWith('/_veryfront/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  await handler(req, res);
});
```

## Deployment Checklist

### Pre-Deployment

- [ ] Build application: `veryfront build`
- [ ] Test build locally: `NODE_ENV=production node server.js`
- [ ] Set environment variables in `.env.production`
- [ ] Configure database connection
- [ ] Set up SSL certificates
- [ ] Configure nginx reverse proxy
- [ ] Set up process manager (PM2)

### Security

- [ ] Enable HTTPS/SSL
- [ ] Set secure environment variables
- [ ] Configure CORS policies
- [ ] Enable rate limiting
- [ ] Set security headers
- [ ] Update dependencies: `npm audit fix`

### Monitoring

- [ ] Set up health check endpoint
- [ ] Configure logging (Winston, Pino)
- [ ] Set up error tracking (Sentry)
- [ ] Configure uptime monitoring
- [ ] Set up performance monitoring

### Post-Deployment

- [ ] Verify application is running
- [ ] Test all routes and functionality
- [ ] Check logs for errors
- [ ] Monitor performance metrics
- [ ] Set up automated backups

## Common Issues

### Port Already in Use

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Permission Denied

```bash
# Allow binding to port 80/443
sudo setcap 'cap_net_bind_service=+ep' $(which node)
```

### Out of Memory

```bash
# Increase Node.js memory limit
NODE_OPTIONS="--max-old-space-size=4096" node server.js
```

## Best Practices

### 1. Use Process Manager

```bash
# ❌ Bad: Direct node execution
node server.js

# ✅ Good: Use PM2 for clustering and auto-restart
pm2 start ecosystem.config.js
```

### 2. Enable Graceful Shutdown

```javascript
// ✅ Good: Handle shutdown signals
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});
```

### 3. Set Resource Limits

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    max_memory_restart: '1G',  // Restart if memory exceeds 1GB
    instances: 'max',          // Use all CPU cores
  }],
};
```

### 4. Use Environment Variables

```bash
# ❌ Bad: Hardcoded values
const DB_URL = 'postgresql://localhost:5432/db';

# ✅ Good: Use environment variables
const DB_URL = process.env.DATABASE_URL;
```

## Next Steps

- Explore [Bun deployment](/docs/guides/deployment/bun.md) for faster runtime
- Learn about [Cloudflare Workers](/docs/guides/deployment/cloudflare.md) for edge deployment
- Read [Performance Optimization](/docs/guides/performance/optimization.md) guide
- Check [Caching Strategies](/docs/guides/performance/caching.md) for better performance
