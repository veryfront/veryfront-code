---
title: "Incremental Static Regeneration (ISR) Guide"
category: "rendering"
level: "intermediate"
keywords: ["isr", "incremental-static-regeneration", "revalidate", "stale-while-revalidate"]
ai_summary: "Complete guide to Incremental Static Regeneration in Veryfront with time-based revalidation, on-demand updates, and the best of SSG and SSR"
related: ["rendering/comparison", "rendering/ssg", "rendering/ssr", "rendering/jit"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Incremental Static Regeneration (ISR) Guide

Incremental Static Regeneration (ISR) combines the best of SSG and SSR. Pages are pre-generated at build time, then **automatically regenerated in the background** after a specified time period.

## What is ISR?

ISR regenerates static pages automatically:

1. **Build time** → Pages pre-generated (like SSG)
2. **User request** → Cached page served instantly
3. **Revalidation time expires** → Next request triggers regeneration
4. **Background regeneration** → New version generated while serving stale
5. **New version ready** → Future requests get updated page

**Result:** Near-instant performance with automatically updating content.

---

## Why Use ISR?

### Perfect for:
- **News sites** - Articles update periodically
- **E-commerce** - Product prices/stock change
- **Analytics dashboards** - Stats update hourly/daily
- **Content sites** - Blog posts get edits/updates
- **API-driven content** - External data changes regularly

### Advantages:
- ✅ **Fast Like SSG** - Pre-built pages, instant delivery
- ✅ **Fresh Like SSR** - Automatic updates without rebuilds
- ✅ **No Manual Rebuilds** - Content stays current automatically
- ✅ **Stale-While-Revalidate** - Users never wait for regeneration
- ✅ **Lower Server Load** - Only regenerates when needed

### Trade-offs:
- ❌ **Not Real-Time** - Delay between updates (revalidation period)
- ❌ **Stale Content Possible** - Users may see outdated version briefly
- ❌ **Cache Complexity** - Requires understanding revalidation

**When to use:** Content that updates periodically but doesn't need real-time accuracy.

---

## Getting Started

### Basic ISR Page

```typescript
// app/blog/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({ params: { slug: post.slug } })),
    fallback: 'blocking'  // Generate new posts on-demand
  };
};

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post },
    revalidate: 3600  // Regenerate every hour (3600 seconds)
  };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>Last updated: {post.updatedAt}</p>
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
    </article>
  );
};

export default BlogPost;
```

**How it works:**
1. Build: Pre-generate all blog posts
2. Request: Serve cached HTML instantly
3. After 1 hour: Next request triggers background regeneration
4. User sees: Stale version (still fast!)
5. New version: Ready for subsequent requests

---

## Revalidation Strategies

### Time-Based Revalidation

```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();

  return {
    props: { data },
    revalidate: 60  // Regenerate every 60 seconds
  };
};
```

**Common revalidation periods:**
- `10` - 10 seconds (near real-time)
- `60` - 1 minute (frequently updated)
- `300` - 5 minutes (regular updates)
- `3600` - 1 hour (periodic updates)
- `86400` - 24 hours (daily updates)

### Conditional Revalidation

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  const isRecent = Date.now() - post.publishedAt < 86400000; // 24h

  return {
    props: { post },
    // Recent posts: revalidate every 5 minutes
    // Older posts: revalidate every 24 hours
    revalidate: isRecent ? 300 : 86400
  };
};
```

### Priority-Based Revalidation

```typescript
export const getServerData = async (ctx: DataContext) => {
  const product = await fetchProduct(ctx.params.id);

  // High-traffic products update more frequently
  const revalidate = product.popularity > 1000 ? 60 : 3600;

  return {
    props: { product },
    revalidate
  };
};
```

---

## On-Demand Revalidation

Manually trigger page regeneration without waiting for revalidation time.

### Trigger Revalidation from API

```typescript
// app/api/revalidate/route.ts
import { revalidatePath } from 'veryfront';

export async function POST(request: Request) {
  const body = await request.json();
  const { path, secret } = body;

  // Verify secret
  if (secret !== getEnv('REVALIDATE_SECRET')) {
    return Response.json({ message: 'Invalid secret' }, { status: 401 });
  }

  try {
    await revalidatePath(path);
    return Response.json({ revalidated: true, path });
  } catch (error) {
    return Response.json(
      { message: 'Error revalidating' },
      { status: 500 }
    );
  }
}
```

**Usage:**
```bash
curl -X POST https://example.com/api/revalidate \
  -H "Content-Type: application/json" \
  -d '{"path":"/blog/my-post","secret":"YOUR_SECRET"}'
```

### Webhook Integration

```typescript
// app/api/webhooks/cms/route.ts
import { revalidatePath } from 'veryfront';

export async function POST(request: Request) {
  const webhook = await request.json();

  // Verify webhook signature
  const signature = request.headers.get('x-webhook-signature');
  if (!verifySignature(webhook, signature)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Revalidate updated content
  if (webhook.type === 'post.updated') {
    await revalidatePath(`/blog/${webhook.data.slug}`);
  }

  if (webhook.type === 'post.published') {
    await revalidatePath('/blog');  // Revalidate blog index
    await revalidatePath(`/blog/${webhook.data.slug}`);
  }

  return Response.json({ success: true });
}
```

### Admin Dashboard Trigger

```typescript
// app/admin/revalidate/page.tsx
'use client';

import { useState } from 'react';

export default function RevalidatePage() {
  const [path, setPath] = useState('');
  const [status, setStatus] = useState('');

  const handleRevalidate = async () => {
    setStatus('Revalidating...');

    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path,
        secret: process.env.NEXT_PUBLIC_REVALIDATE_SECRET
      })
    });

    if (response.ok) {
      setStatus('✓ Revalidated successfully');
    } else {
      setStatus('✗ Failed to revalidate');
    }
  };

  return (
    <div>
      <h1>Revalidate Page</h1>
      <input
        type="text"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder="/blog/my-post"
      />
      <button onClick={handleRevalidate}>Revalidate</button>
      <p>{status}</p>
    </div>
  );
}
```

---

## Real-World Examples

### News Site

```typescript
// app/news/[id]/page.tsx
export const getStaticPaths = async () => {
  const recentArticles = await fetchRecentArticles({ limit: 100 });

  return {
    paths: recentArticles.map(a => ({ params: { id: a.id } })),
    fallback: 'blocking'  // Older articles generated on-demand
  };
};

export const getServerData = async (ctx: DataContext) => {
  const article = await fetchArticle(ctx.params.id);
  const relatedArticles = await fetchRelatedArticles(article.id, { limit: 3 });

  return {
    props: { article, relatedArticles },
    revalidate: 300  // Update every 5 minutes
  };
};
```

### E-commerce Product Page

```typescript
// app/products/[id]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const [product, reviews, inventory] = await Promise.all([
    fetchProduct(ctx.params.id),
    fetchProductReviews(ctx.params.id),
    checkInventory(ctx.params.id)
  ]);

  return {
    props: { product, reviews, inventory },
    revalidate: 60  // Price/stock updates every minute
  };
};

const ProductPage: PageWithData<{
  product: Product;
  reviews: Review[];
  inventory: Inventory;
}> = ({ product, reviews, inventory }) => {
  return (
    <div>
      <h1>{product.name}</h1>
      <p>Price: ${product.price}</p>
      <p>In Stock: {inventory.quantity}</p>
      <p>Rating: {reviews.averageRating} ({reviews.count} reviews)</p>
    </div>
  );
};
```

### Analytics Dashboard

```typescript
// app/dashboard/stats/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  if (!user) {
    return { redirect: '/login' };
  }

  const stats = await fetchUserStats(user.id);

  return {
    props: { stats },
    revalidate: 3600  // Update every hour
  };
};
```

### GitHub Profile

```typescript
// app/users/[username]/page.tsx
export const getStaticPaths = async () => {
  return {
    paths: [],  // No pre-generation
    fallback: 'blocking'  // Generate all on-demand
  };
};

export const getServerData = async (ctx: DataContext) => {
  const username = ctx.params.username;

  const [user, repos] = await Promise.all([
    fetch(`https://api.github.com/users/${username}`).then(r => r.json()),
    fetch(`https://api.github.com/users/${username}/repos`).then(r => r.json())
  ]);

  if (!user || user.message === 'Not Found') {
    return { notFound: true };
  }

  return {
    props: { user, repos },
    revalidate: 86400  // Update daily
  };
};
```

---

## Advanced Patterns

### Stale-While-Revalidate

Users always get instant response, even during regeneration:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();

  return {
    props: { data },
    revalidate: 60,
    // Serve stale content for 5 minutes while revalidating
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300'
    }
  };
};
```

### Cascading Revalidation

Revalidate related pages when one updates:

```typescript
// app/api/webhooks/post-updated/route.ts
import { revalidatePath } from 'veryfront';

export async function POST(request: Request) {
  const { post } = await request.json();

  // Revalidate the post itself
  await revalidatePath(`/blog/${post.slug}`);

  // Revalidate blog index
  await revalidatePath('/blog');

  // Revalidate category page
  await revalidatePath(`/blog/category/${post.category}`);

  // Revalidate author page
  await revalidatePath(`/authors/${post.author.id}`);

  return Response.json({ success: true });
}
```

### Selective Revalidation

Only revalidate if content actually changed:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  const cachedHash = await getCachedHash(ctx.params.slug);
  const currentHash = hashContent(post);

  // Only revalidate if content changed
  const revalidate = cachedHash !== currentHash ? 60 : 3600;

  await setCachedHash(ctx.params.slug, currentHash);

  return {
    props: { post },
    revalidate
  };
};
```

---

## Performance Optimization

### Smart Revalidation

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  const hoursSinceUpdate = (Date.now() - post.updatedAt) / 3600000;

  // Recently updated: check frequently
  // Not updated recently: check infrequently
  const revalidate = hoursSinceUpdate < 24 ? 300 : 86400;

  return {
    props: { post },
    revalidate
  };
};
```

### Cache Tags

Group related pages for batch revalidation:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post },
    revalidate: 3600,
    tags: ['posts', `category:${post.category}`, `author:${post.author.id}`]
  };
};

// Revalidate all posts in a category
await revalidateTag(`category:${categoryId}`);

// Revalidate all posts by an author
await revalidateTag(`author:${authorId}`);
```

### Background Jobs

Schedule periodic revalidation:

```typescript
// cron job or background worker
setInterval(async () => {
  const popularPosts = await fetchPopularPosts({ limit: 10 });

  for (const post of popularPosts) {
    await revalidatePath(`/blog/${post.slug}`);
  }
}, 3600000); // Every hour
```

---

## Monitoring & Debugging

### Revalidation Logs

```typescript
export const getServerData = async (ctx: DataContext) => {
  const startTime = Date.now();
  const data = await fetchData();
  const fetchTime = Date.now() - startTime;

  console.log('ISR Regeneration:', {
    path: ctx.pathname,
    fetchTime,
    timestamp: new Date().toISOString()
  });

  return {
    props: { data },
    revalidate: 60
  };
};
```

### Revalidation Headers

Add custom headers to track regeneration:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();

  return {
    props: { data },
    revalidate: 3600,
    headers: {
      'X-Generated-At': new Date().toISOString(),
      'X-Revalidate': '3600'
    }
  };
};
```

### Admin Dashboard

```typescript
// app/admin/isr-status/page.tsx
export const getServerData = async () => {
  const cacheStats = await getCacheStatistics();

  return {
    props: { cacheStats },
    revalidate: 60
  };
};

const ISRStatus: PageWithData<{ cacheStats: CacheStats }> = ({
  cacheStats
}) => {
  return (
    <div>
      <h1>ISR Status</h1>
      <p>Cached Pages: {cacheStats.totalPages}</p>
      <p>Revalidations Today: {cacheStats.revalidationsToday}</p>
      <p>Average Generation Time: {cacheStats.avgGenerationTime}ms</p>
    </div>
  );
};
```

---

## Best Practices

### 1. Choose Appropriate Revalidation Times

```typescript
// Too aggressive: Server load + costs
revalidate: 10  // ❌ Every 10 seconds

// Just right: Balance freshness + performance
revalidate: 300  // ✅ Every 5 minutes

// Too conservative: Stale content
revalidate: 604800  // ⚠️ Weekly (consider JIT instead)
```

### 2. Use On-Demand When Possible

```typescript
// Time-based: Updates even if content unchanged
revalidate: 60  // ❌ Wastes resources

// On-demand: Only update when content changes
// No revalidate, only webhook triggers  // ✅ Efficient
```

### 3. Handle Revalidation Errors

```typescript
export const getServerData = async (ctx: DataContext) => {
  try {
    const data = await fetchData();
    return {
      props: { data },
      revalidate: 3600
    };
  } catch (error) {
    console.error('Revalidation failed:', error);

    // Return cached data or fallback
    const cached = await getCachedData();
    return {
      props: { data: cached || [] },
      revalidate: 300  // Retry sooner
    };
  }
};
```

### 4. Consider User Experience

```typescript
// Show when page was last updated
const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>Last updated: {formatDate(post.updatedAt)}</p>
      <p><small>Page refreshes every 5 minutes</small></p>
      <div>{post.content}</div>
    </article>
  );
};
```

---

## ISR vs Other Rendering Modes

| Feature | ISR | SSG | SSR | JIT |
|---------|-----|-----|-----|-----|
| **Initial Build** | Pre-generated | Pre-generated | None | None |
| **Response Time** | Instant | Instant | Medium | Instant (cached) |
| **Updates** | Automatic | Manual rebuild | Every request | Manual invalidate |
| **Freshness** | Periodic | Stale | Always fresh | Stale until invalidate |
| **Server Load** | Low | None | High | Low |
| **Use Case** | Periodic updates | Static content | Dynamic data | Rare updates |

**Choose ISR when:**
- Content updates regularly but not constantly
- You want SSG speed with automatic updates
- You can tolerate slight staleness
- You want to avoid manual rebuilds

**Consider alternatives when:**
- Content never changes → SSG
- Content must be real-time → SSR
- Content updates very rarely → JIT
- Full control over regeneration → JIT

---

## Related Documentation

- [Rendering Comparison](./comparison.md) - Choose the right mode
- [SSG Guide](./ssg.md) - Static Site Generation
- [SSR Guide](./ssr.md) - Server-Side Rendering
- [JIT Guide](./jit.md) - Just-In-Time Rendering
- [Data Fetching API](/reference/functions/get-server-data.md) - Complete reference

---

## Examples

- [News Site](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - ISR for articles
- [E-commerce](https://github.com/veryfrontjs/veryfront/tree/main/examples/full-demo) - ISR for products
- [Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - ISR for posts

---

## Quick Reference

### Basic ISR
```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();
  return {
    props: { data },
    revalidate: 3600  // Regenerate every hour
  };
};
```

### On-Demand Revalidation
```typescript
// API route
import { revalidatePath } from 'veryfront';
await revalidatePath('/blog/my-post');
```

### With Fallback
```typescript
export const getStaticPaths = async () => {
  return {
    paths: popularPaths,
    fallback: 'blocking'
  };
};
```

### Conditional Revalidation
```typescript
const revalidate = isRecent ? 300 : 86400;
return { props: { data }, revalidate };
```
