---
title: "Rendering System Overview"
category: "rendering"
level: "beginner"
keywords: ["rendering", "ssr", "ssg", "isr", "jit", "rsc", "server-side", "static"]
ai_summary: "Complete overview of Veryfront's five rendering modes: SSR, SSG, ISR, JIT, and RSC with use cases and examples"
related: ["rendering/comparison", "rendering/ssr", "rendering/ssg", "rendering/isr", "rendering/jit", "rendering/rsc"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Rendering System Overview

Veryfront provides five powerful rendering modes, giving you complete control over how your pages are generated and served. Choose the right mode for each page based on your content and performance needs.

## The Five Rendering Modes

### 1. Server-Side Rendering (SSR)
**Generate HTML on every request**

Renders fresh HTML on the server for each request. Perfect for dynamic, personalized, or real-time content.

```typescript
// SSR happens automatically when you use getServerData
export const getServerData = async (ctx) => {
  const user = await getUser(ctx.request);
  const feed = await getFeed(user.id);
  return { props: { user, feed } };
};
```

**Use for:** User dashboards, real-time feeds, personalized content

Learn more: [SSR Guide](./ssr.md)

---

### 2. Static Site Generation (SSG)
**Pre-render pages at build time**

Generates all HTML files during the build process. Serves static files for instant page loads.

```typescript
// Pre-generate all blog posts
export const getStaticPaths = async () => {
  const posts = await getAllPosts();
  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: false,
  };
};

export const getServerData = async (ctx) => {
  const post = await getPost(ctx.params.slug);
  return { props: { post } };
};
```

**Use for:** Blogs, documentation, marketing pages, portfolios

Learn more: [SSG Guide](./ssg.md)

---

### 3. Incremental Static Regeneration (ISR)
**Update static pages periodically**

Pre-renders pages at build time, then automatically regenerates them in the background after a specified time period.

```typescript
export const getServerData = async (ctx) => {
  const product = await getProduct(ctx.params.id);
  return {
    props: { product },
    revalidate: 3600, // Regenerate every hour
  };
};
```

**Use for:** E-commerce, news sites, content that updates periodically

Learn more: [ISR Guide](./isr.md)

---

### 4. Just-In-Time (JIT) Rendering
**Generate on first visit, cache forever**

Veryfront's unique rendering mode. Generates pages on the first request, then caches them permanently. Perfect for massive-scale sites.

```typescript
export const getServerData = async (ctx) => {
  const doc = await getDoc(ctx.params.path);
  return {
    props: { doc },
    cache: 'forever', // Cache indefinitely
  };
};
```

**Use for:** Large documentation sites (100k+ pages), Wikipedia-style content

Learn more: [JIT Guide](./jit.md)

---

### 5. React Server Components (RSC)
**Render React components on the server**

Experimental support for React Server Components. Render components on the server, send minimal JavaScript to the client.

```typescript
// Server Component - no 'use client' directive
export default async function ProductPage({ params }) {
  const product = await db.products.find(params.id);

  return (
    <div>
      <h1>{product.name}</h1>
      <ClientButton product={product} />
    </div>
  );
}
```

**Use for:** Interactive apps with minimal JavaScript, data-heavy dashboards

Learn more: [RSC Guide](./rsc.md)

---

## Quick Comparison

| Mode | Speed | Data Freshness | Build Time | Best For |
|------|-------|----------------|------------|----------|
| **SSR** | Medium | Real-time | None | Dashboards, personalized |
| **SSG** | Fastest | Stale | Slow (large) | Blogs, docs, marketing |
| **ISR** | Fast | Periodic | Fast | E-commerce, news |
| **JIT** | Fast* | Stale | None | Massive sites (100k+ pages) |
| **RSC** | Fast | Real-time | None | Interactive, minimal JS |

*After first visit

## How to Choose?

Start here: [Rendering Mode Comparison](./comparison.md)

**Quick decision:**
- **Content changes often?** → SSR
- **Same for everyone?** → SSG
- **Updates hourly/daily?** → ISR
- **100,000+ pages?** → JIT
- **Need minimal JavaScript?** → RSC

## Rendering Pipeline

### Request Flow

```
User Request
    ↓
Router matches route
    ↓
Check rendering mode
    ↓
┌─────────────────┬──────────────┬─────────────┬──────────────┬────────────┐
│      SSR        │     SSG      │     ISR     │     JIT      │    RSC     │
├─────────────────┼──────────────┼─────────────┼──────────────┼────────────┤
│ Run getServerData│ Serve cached │ Check cache │ Check cache  │ Run server │
│ on every request│ static file  │ age         │              │ components │
│                 │              │             │              │            │
│ Render on server│ (instant)    │ If expired: │ If miss:     │ Render on  │
│                 │              │ - Serve old │ - Generate   │ server     │
│                 │              │ - Regenerate│ - Cache      │            │
│                 │              │   in bg     │   forever    │            │
└─────────────────┴──────────────┴─────────────┴──────────────┴────────────┘
    ↓
Send HTML to client
    ↓
Hydrate with React
```

## Configuration

### Setting Rendering Mode

The rendering mode is determined by what you export from your page:

```typescript
// SSR (default) - just use getServerData
export const getServerData = async (ctx) => { ... };

// SSG - add getStaticPaths
export const getStaticPaths = async () => { ... };
export const getServerData = async (ctx) => { ... };

// ISR - add revalidate
export const getServerData = async (ctx) => {
  return {
    props: { ... },
    revalidate: 3600, // seconds
  };
};

// JIT - set cache to 'forever'
export const getServerData = async (ctx) => {
  return {
    props: { ... },
    cache: 'forever',
  };
};

// RSC - use async components (experimental)
export default async function Page() { ... }
```

### Global Configuration

Set defaults in `veryfront.config.ts`:

```typescript
export default {
  rendering: {
    default: 'ssg', // or 'ssr', 'isr', 'jit'
    ssr: {
      cache: {
        enabled: true,
        ttl: 60, // seconds
      },
    },
    ssg: {
      fallback: 'blocking', // or false, true
    },
    isr: {
      defaultRevalidate: 3600,
    },
  },
};
```

## Data Fetching

### Server-Side Data Fetching

All rendering modes use `getServerData` for data fetching:

```typescript
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // Access request context
  const { params, query, request, headers } = ctx;

  // Fetch your data
  const data = await fetchData(params.id);

  // Return props
  return { props: { data } };
};

const Page: PageWithData<{ data: MyData }> = ({ data }) => {
  return <div>{data.title}</div>;
};

export default Page;
```

### Client-Side Data Fetching

Use standard React patterns for client-side data:

```typescript
'use client'; // App Router: mark as client component

import { useState, useEffect } from 'react';

export default function ClientDataPage() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(res => res.json())
      .then(setData);
  }, []);

  return <div>{data?.title}</div>;
}
```

## Performance Optimization

### Caching Strategies

**SSR with Cache:**
```typescript
export const getServerData = async (ctx) => {
  return {
    props: { data },
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
    },
  };
};
```

**ISR with Background Regeneration:**
```typescript
export const getServerData = async (ctx) => {
  return {
    props: { data },
    revalidate: 3600, // Revalidate every hour
  };
};
```

**JIT with Permanent Cache:**
```typescript
export const getServerData = async (ctx) => {
  return {
    props: { data },
    cache: 'forever',
  };
};
```

### Code Splitting

Veryfront automatically code-splits by route. Use dynamic imports for additional optimization:

```typescript
import dynamic from 'veryfront/dynamic';

const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <p>Loading...</p>,
});
```

## Mixing Rendering Modes

Different pages can use different rendering modes in the same app:

```
app/
├── page.tsx                    # SSG (homepage)
├── blog/
│   ├── page.tsx                # SSG (blog list)
│   └── [slug]/
│       └── page.tsx            # ISR (blog posts)
├── products/
│   └── [id]/
│       └── page.tsx            # ISR (products)
├── dashboard/
│   └── page.tsx                # SSR (user dashboard)
└── docs/
    └── [...slug]/
        └── page.tsx            # JIT (large docs)
```

Each page independently declares its rendering strategy through its exports.

## Best Practices

1. **Start with SSG** - It's the simplest and fastest. Only move to other modes when you hit SSG's limitations.

2. **Use ISR for "mostly static"** - If content updates periodically but doesn't need to be instant, ISR gives you both speed and freshness.

3. **Reserve SSR for truly dynamic** - Only use SSR when you need per-request data (user-specific, real-time, auth).

4. **Consider JIT for scale** - When you have so many pages that build times become prohibitive (> 10 minutes), switch to JIT.

5. **Mix modes freely** - Different pages have different needs. Use the right mode for each page.

## Common Patterns

### Blog with Dynamic Comments
- **Post content:** ISR (regenerate hourly)
- **Comments:** Client-side fetch (real-time)

```typescript
// Post page (ISR)
export const getServerData = async (ctx) => {
  const post = await getPost(ctx.params.slug);
  return {
    props: { post },
    revalidate: 3600, // Regenerate every hour
  };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <>
      <article>{post.content}</article>
      <Comments postId={post.id} /> {/* Client component */}
    </>
  );
};
```

### E-commerce with Personalization
- **Product pages:** ISR (price updates daily)
- **Cart:** SSR (user-specific)
- **Category pages:** SSG (static structure)

### Documentation Site
- **Docs (< 1k pages):** SSG (pre-render all)
- **Docs (100k+ pages):** JIT (generate on-demand)
- **Search:** SSR or client-side

## SEO Considerations

All rendering modes are SEO-friendly:

- **SSR:** ✅ Fresh content, perfect for search engines
- **SSG:** ✅ Static HTML, crawlers love it
- **ISR:** ✅ Static HTML with periodic updates
- **JIT:** ✅ Generated HTML cached and served
- **RSC:** ✅ Server-rendered HTML

All modes serve complete HTML on first request, ensuring search engines can crawl and index your content.

## Deployment Considerations

### Hosting Requirements

| Mode | Requires | Best Platform |
|------|----------|---------------|
| SSR | Node/Deno server | Deno Deploy, Vercel, Railway |
| SSG | Static hosting | Deno Deploy, Netlify, Vercel, S3 |
| ISR | Edge functions | Deno Deploy, Vercel, Cloudflare |
| JIT | Edge functions + KV | Deno Deploy, Cloudflare Workers |
| RSC | Edge runtime | Deno Deploy, Vercel |

### Build Times

- **SSR:** No build (runtime only)
- **SSG:** Slow for large sites (1000+ pages)
- **ISR:** Fast (partial pre-render)
- **JIT:** No build (generate on-demand)
- **RSC:** Fast (no pre-rendering)

## Prerequisites

Before diving into rendering modes, ensure you have:
- [Veryfront installed](/learn/installation.md) - Set up your development environment
- [Quick Start completed](/learn/quickstart.md) - Built your first application
- [Routing basics](/guides/routing/README.md) - Understand file-based routing

## Next Steps

### Learn Each Rendering Mode
- [Rendering Mode Comparison](./comparison.md) - Detailed comparison and decision matrix
- [SSR Guide](./ssr.md) - Server-Side Rendering for dynamic content
- [SSG Guide](./ssg.md) - Static Site Generation for performance
- [ISR Guide](./isr.md) - Incremental Static Regeneration for periodic updates
- [JIT Guide](./jit.md) - Just-In-Time Rendering for massive sites
- [RSC Guide](./rsc.md) - React Server Components (experimental)

## Related Guides

### Routing Integration
- [Routing System](/guides/routing/README.md) - How routing works with rendering
- [App Router](/guides/routing/app-router.md) - Modern routing patterns
- [Dynamic Routes](/guides/routing/dynamic-routes.md) - Dynamic route rendering
- [API Routes](/guides/routing/api-routes.md) - Server-side APIs

### Performance
- [Performance Overview](/guides/performance/README.md) - Optimization techniques
- [Caching Strategies](/guides/performance/caching.md) - Cache configuration
- [Optimization Guide](/guides/performance/optimization.md) - Performance best practices

### Deployment
- [Deployment Overview](/guides/deployment/README.md) - Deploy rendered applications
- [Deno Deployment](/guides/deployment/deno.md) - Deploy to Deno Deploy
- [Node.js Deployment](/guides/deployment/node.md) - Deploy with Node.js

## Reference

### API Reference
- [Functions](/reference/functions/README.md) - Server-side functions
  - [getServerData](/reference/functions/get-server-data.md) - Fetch data for pages
  - [getStaticPaths](/reference/functions/get-static-paths.md) - Define static paths (SSG)
  - [redirect](/reference/functions/redirect.md) - Redirect during rendering
  - [notFound](/reference/functions/not-found.md) - Return 404 pages

### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Rendering configuration options
- [File Conventions](/reference/file-conventions/README.md) - Special rendering files

## Examples

See working examples:
- [SSR Example](https://github.com/veryfront/veryfront/tree/main/examples/full-demo) - User dashboard with SSR
- [SSG Example](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx) - Static blog with SSG
- [ISR Example](https://github.com/veryfront/veryfront/tree/main/examples/full-demo) - Product catalog with ISR
- [JIT Example](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx) - Large documentation site with JIT
- [RSC Example](https://github.com/veryfront/veryfront/tree/main/examples/rsc-demo) - React Server Components demo

## Troubleshooting

Having rendering issues? Check these guides:
- [Debugging Guide](/guides/troubleshooting/debugging.md) - Debug rendering problems
- [Troubleshooting](/guides/troubleshooting/README.md) - Common rendering issues
