---
title: Caching Strategies
description: Implement effective caching strategies for Veryfront applications
keywords:
  - caching
  - cache strategies
  - HTTP caching
  - CDN caching
  - browser cache
  - service workers
  - cache invalidation
  - stale-while-revalidate
related:
  - /docs/guides/performance/optimization.md
  - /docs/guides/deployment/node.md
  - /docs/guides/deployment/cloudflare.md
---

# Caching Strategies

Implement effective caching strategies to dramatically improve performance, reduce server load, and provide better user experience in your Veryfront applications.

## Overview

Caching layers:

- **Browser Cache**: Local HTTP cache
- **CDN Cache**: Edge network caching
- **Service Workers**: Programmable cache
- **Server Cache**: Application-level caching
- **Database Cache**: Query result caching

## HTTP Caching

### Cache-Control Headers

```typescript
// Server-side caching headers
export default async function handler(req, res) {
  // Static assets - cache forever
  if (req.url?.startsWith('/_veryfront/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return serveStaticAsset(req, res);
  }

  // Dynamic content - cache with revalidation
  if (req.url === '/api/posts') {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400');
    return servePosts(req, res);
  }

  // Private user data - no caching
  if (req.url === '/api/user/profile') {
    res.setHeader('Cache-Control', 'private, no-cache, must-revalidate');
    return serveUserProfile(req, res);
  }
}
```

### Cache Directives

```typescript
// Cache directives reference
const cacheDirectives = {
  // Public - can be cached by anyone (CDN, browser)
  'public': 'public',

  // Private - only browser can cache
  'private': 'private',

  // No cache - must revalidate before use
  'no-cache': 'no-cache',

  // No store - never cache
  'no-store': 'no-store',

  // Max age - how long to cache (seconds)
  'max-age=3600': 'max-age=3600',  // 1 hour

  // S-maxage - CDN cache time
  's-maxage=86400': 's-maxage=86400',  // 24 hours

  // Must revalidate - check server when stale
  'must-revalidate': 'must-revalidate',

  // Immutable - never changes
  'immutable': 'immutable',

  // Stale while revalidate - serve stale while fetching
  'stale-while-revalidate=86400': 'stale-while-revalidate=86400',
};

// Example combinations
const strategies = {
  // Static assets with hash
  staticAssets: 'public, max-age=31536000, immutable',

  // API responses (public data)
  publicAPI: 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400',

  // HTML pages
  htmlPages: 'public, max-age=0, s-maxage=60, must-revalidate',

  // User-specific data
  privateData: 'private, no-cache, must-revalidate',

  // Sensitive data
  sensitiveData: 'private, no-store',
};
```

### ETag and Last-Modified

```typescript
// Generate ETag
import { createHash } from 'node:crypto';

function generateETag(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

// Use ETags for conditional requests
export default async function handler(req, res) {
  const content = await getContent();
  const etag = generateETag(content);

  // Check if client has cached version
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304; // Not Modified
    res.end();
    return;
  }

  // Send new content with ETag
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(content);
}

// Last-Modified header
export default async function handler(req, res) {
  const lastModified = await getLastModified();

  if (req.headers['if-modified-since'] === lastModified) {
    res.statusCode = 304;
    res.end();
    return;
  }

  res.setHeader('Last-Modified', lastModified);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(content);
}
```

## CDN Caching

### Configure CDN Cache

```typescript
// Cloudflare Workers example
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const cache = caches.default;

    // Check cache first
    let response = await cache.match(request);

    if (!response) {
      // Fetch from origin
      response = await fetch(request);

      // Cache successful responses
      if (response.ok) {
        // Clone response before caching
        const cacheResponse = response.clone();

        // Set CDN-specific cache headers
        const headers = new Headers(cacheResponse.headers);
        headers.set('Cache-Control', 'public, max-age=3600');
        headers.set('CDN-Cache-Control', 'max-age=86400');

        const cachedResponse = new Response(cacheResponse.body, {
          status: cacheResponse.status,
          headers,
        });

        // Cache in background
        ctx.waitUntil(cache.put(request, cachedResponse));
      }
    }

    return response;
  },
};
```

### Cache Key Strategies

```typescript
// Custom cache keys
function generateCacheKey(request: Request): Request {
  const url = new URL(request.url);

  // Remove query params that don't affect response
  url.searchParams.delete('utm_source');
  url.searchParams.delete('utm_medium');
  url.searchParams.delete('fbclid');

  // Sort query params for consistent keys
  url.searchParams.sort();

  // Include important headers in cache key
  const cacheKey = new Request(url.toString(), {
    method: request.method,
    headers: {
      'Accept-Encoding': request.headers.get('Accept-Encoding') || '',
      'Accept-Language': request.headers.get('Accept-Language') || '',
    },
  });

  return cacheKey;
}

// Use custom cache key
const cacheKey = generateCacheKey(request);
const cached = await cache.match(cacheKey);
```

### Cache Purging

```bash
# Cloudflare cache purge
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"purge_everything":true}'

# Purge specific URLs
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  --data '{"files":["https://example.com/style.css","https://example.com/script.js"]}'
```

## Service Worker Caching

### Install Service Worker

```typescript
// public/sw.js
const CACHE_NAME = 'veryfront-v1';
const urlsToCache = [
  '/',
  '/styles/main.css',
  '/script/bundle.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
  );
});

// Register service worker
// app/layout.tsx
'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then((registration) => {
          console.log('SW registered:', registration);
        })
        .catch((error) => {
          console.log('SW registration failed:', error);
        });
    }
  }, []);

  return null;
}
```

### Cache-First Strategy

```typescript
// public/sw.js
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached response if found
        if (response) {
          return response;
        }

        // Otherwise fetch from network
        return fetch(event.request)
          .then((response) => {
            // Cache successful responses
            if (response.ok) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => {
                  cache.put(event.request, responseClone);
                });
            }
            return response;
          });
      })
  );
});
```

### Network-First Strategy

```typescript
// public/sw.js
self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache and return network response
        const responseClone = response.clone();
        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseClone);
          });
        return response;
      })
      .catch(() => {
        // Fallback to cache on network failure
        return caches.match(event.request);
      })
  );
});
```

### Stale-While-Revalidate

```typescript
// public/sw.js
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((cachedResponse) => {
        // Fetch from network in background
        const fetchPromise = fetch(event.request).then((networkResponse) => {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        });

        // Return cached response immediately, or network response if no cache
        return cachedResponse || fetchPromise;
      });
    })
  );
});
```

## Application-Level Caching

### In-Memory Cache

```typescript
// lib/cache.ts
class MemoryCache {
  private cache = new Map<string, { value: any; expiry: number }>();

  set(key: string, value: any, ttl: number = 3600): void {
    const expiry = Date.now() + (ttl * 1000);
    this.cache.set(key, { value, expiry });
  }

  get(key: string): any | null {
    const item = this.cache.get(key);

    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

export const cache = new MemoryCache();

// Usage
import { cache } from '@/lib/cache';

export async function fetchPosts() {
  const cached = cache.get('posts');
  if (cached) return cached;

  const posts = await db.posts.findMany();
  cache.set('posts', posts, 3600);
  return posts;
}
```

### Redis Cache

```typescript
// lib/redis.ts
import { createClient } from 'redis';

const redis = createClient({
  url: process.env.REDIS_URL,
});

await redis.connect();

// Cache wrapper
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 3600
): Promise<T> {
  // Check cache
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  // Fetch and cache
  const data = await fetcher();
  await redis.setEx(key, ttl, JSON.stringify(data));
  return data;
}

// Usage
export async function getUser(id: string) {
  return cachedFetch(
    `user:${id}`,
    () => db.users.findUnique({ where: { id } }),
    3600
  );
}
```

### LRU Cache

```typescript
// lib/lru-cache.ts
import LRU from 'lru-cache';

const cache = new LRU<string, any>({
  max: 500,  // Maximum items
  ttl: 1000 * 60 * 60,  // 1 hour TTL
  updateAgeOnGet: true,
  updateAgeOnHas: false,
});

export async function cachedQuery<T>(
  key: string,
  query: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const result = await query();
  cache.set(key, result);
  return result;
}

// Usage
export async function getProducts() {
  return cachedQuery('products', async () => {
    return await db.products.findMany();
  });
}
```

## Cache Invalidation

### Time-Based Invalidation

```typescript
// Simple TTL
cache.set('key', value, 3600); // Expires in 1 hour

// Scheduled invalidation
setInterval(() => {
  cache.clear();
}, 3600 * 1000); // Clear every hour
```

### Event-Based Invalidation

```typescript
// Invalidate on data change
export async function createPost(data: any) {
  const post = await db.posts.create({ data });

  // Invalidate related caches
  cache.delete('posts');
  cache.delete(`post:${post.id}`);
  cache.delete('post-count');

  return post;
}

// Tag-based invalidation
const taggedCache = {
  set(key: string, value: any, tags: string[]) {
    cache.set(key, value);
    tags.forEach(tag => {
      const tagged = cache.get(`tag:${tag}`) || [];
      tagged.push(key);
      cache.set(`tag:${tag}`, tagged);
    });
  },

  invalidateTag(tag: string) {
    const keys = cache.get(`tag:${tag}`) || [];
    keys.forEach((key: string) => cache.delete(key));
    cache.delete(`tag:${tag}`);
  },
};

// Usage
taggedCache.set('post:1', post, ['posts', 'user:1']);
taggedCache.invalidateTag('posts'); // Invalidates all posts
```

### Manual Cache Purge

```typescript
// API endpoint for cache purge
export async function POST(req: Request) {
  const { key, pattern } = await req.json();

  // Purge single key
  if (key) {
    cache.delete(key);
    return Response.json({ purged: [key] });
  }

  // Purge by pattern
  if (pattern) {
    const keys = Array.from(cache.keys())
      .filter(k => k.includes(pattern));

    keys.forEach(k => cache.delete(k));
    return Response.json({ purged: keys });
  }

  return Response.json({ error: 'No key or pattern provided' }, { status: 400 });
}
```

## Caching Best Practices

### 1. Cache Static Assets Forever

```typescript
// ✅ Good: Static assets with hash in filename
res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

// File: bundle-abc123.js never changes
```

### 2. Use Stale-While-Revalidate

```typescript
// ✅ Good: Serve cached while updating
res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=86400');

// Serves cached for 60s, then stale for 24h while revalidating
```

### 3. Cache API Responses

```typescript
// ✅ Good: Cache public API data
export async function GET(req: Request) {
  const data = await fetchData();

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
    },
  });
}
```

### 4. Don't Cache User-Specific Data

```typescript
// ✅ Good: Private user data
export async function GET(req: Request) {
  const user = await getUser(req);

  return new Response(JSON.stringify(user), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-cache, must-revalidate',
    },
  });
}
```

### 5. Implement Cache Warming

```typescript
// Warm cache on deployment
async function warmCache() {
  const criticalRoutes = [
    '/api/products',
    '/api/categories',
    '/api/homepage',
  ];

  await Promise.all(
    criticalRoutes.map(route =>
      fetch(`https://example.com${route}`)
    )
  );
}

// Run on startup
warmCache();
```

## Cache Monitoring

### Track Cache Hit Rate

```typescript
let hits = 0;
let misses = 0;

function getCacheStats() {
  const total = hits + misses;
  const hitRate = total > 0 ? (hits / total) * 100 : 0;

  return {
    hits,
    misses,
    total,
    hitRate: `${hitRate.toFixed(2)}%`,
  };
}

// Track in cache wrapper
export async function cachedFetch(key: string, fetcher: Function) {
  const cached = cache.get(key);

  if (cached) {
    hits++;
    return cached;
  }

  misses++;
  const data = await fetcher();
  cache.set(key, data);
  return data;
}

// Expose metrics endpoint
export async function GET() {
  return Response.json(getCacheStats());
}
```

## Common Caching Patterns

### Read-Through Cache

```typescript
async function readThrough(key: string, fetcher: Function) {
  const cached = await cache.get(key);
  if (cached) return cached;

  const data = await fetcher();
  await cache.set(key, data);
  return data;
}
```

### Write-Through Cache

```typescript
async function writeThrough(key: string, data: any) {
  await db.save(data);
  await cache.set(key, data);
  return data;
}
```

### Cache-Aside

```typescript
// Application manages cache manually
async function getUser(id: string) {
  // Try cache first
  const cached = await cache.get(`user:${id}`);
  if (cached) return cached;

  // Load from DB
  const user = await db.users.findUnique({ where: { id } });

  // Store in cache
  await cache.set(`user:${id}`, user);

  return user;
}
```

## Performance Checklist

- [ ] Configure Cache-Control headers for all routes
- [ ] Use immutable for static assets with hash
- [ ] Implement stale-while-revalidate for public APIs
- [ ] Set up CDN caching with proper purge strategy
- [ ] Implement Service Worker for offline support
- [ ] Use Redis/Memcached for application cache
- [ ] Implement cache invalidation strategy
- [ ] Monitor cache hit rate
- [ ] Warm cache on deployment
- [ ] Test cache behavior in production

## Next Steps

- Review [Performance Optimization](/guides/performance/optimization.md)
- Configure [CDN deployment](/guides/deployment/cloudflare.md)
- Implement [Node.js caching](/guides/deployment/node.md)
- Learn about [Bun performance](/guides/deployment/bun.md)
