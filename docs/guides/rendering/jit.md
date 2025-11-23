---
title: JIT (Just-In-Time) Rendering
description: Cache-forever rendering with manual invalidation for Veryfront
category: rendering
tags: [jit, caching, performance, rendering]
related:
  - rendering/isr
  - rendering/ssg
  - rendering/comparison
  - api/revalidation
difficulty: intermediate
---

# JIT (Just-In-Time) Rendering

Just-In-Time (JIT) rendering is a **Veryfront-specific** rendering strategy that generates pages on-demand and caches them **forever** until manually invalidated. Unlike ISR which uses time-based revalidation, JIT pages stay cached indefinitely, giving you complete control over when content updates.

## Overview

JIT combines the benefits of static generation with dynamic flexibility:

- ✅ **First Request**: Page generated on-demand (like SSR)
- ✅ **Subsequent Requests**: Served from cache instantly (like SSG)
- ✅ **Cache Duration**: Forever, until you explicitly invalidate it
- ✅ **Control**: Manual invalidation via API calls or webhooks
- ✅ **Performance**: Same speed as static pages after first render
- ✅ **Flexibility**: Update content exactly when needed, not on a schedule

### When to Use JIT

JIT is ideal for:

- **Editorial Content**: Articles, blog posts that rarely change
- **Product Pages**: E-commerce products with infrequent updates
- **Documentation**: Technical docs that update on-demand
- **User Profiles**: Public profiles that change when users edit them
- **Admin-Controlled Content**: Content updated through CMS or admin dashboard
- **Event Pages**: Conference/event pages that change when organizers update them
- **Marketing Pages**: Landing pages that update during campaigns

### When NOT to Use JIT

Avoid JIT for:

- **Real-Time Data**: Stock prices, live scores, chat (use SSR)
- **Personalized Content**: User dashboards, recommendations (use SSR)
- **Frequently Updated**: News feeds, social media (use ISR with short revalidation)
- **Time-Sensitive**: Content with known update schedules (use ISR)
- **Analytics Dashboards**: Real-time metrics (use SSR)

## Getting Started

### Basic JIT Page

Set `cache: 'forever'` in your data fetching function:

```typescript
// app/blog/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchBlogPost(ctx.params.slug);

  if (!post) {
    return { notFound: true };
  }

  return {
    props: { post },
    cache: 'forever'  // Cache indefinitely until manually invalidated
  };
};

const BlogPostPage: PageWithData<{ post: BlogPost }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <time>{new Date(post.publishedAt).toLocaleDateString()}</time>
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
    </article>
  );
};

export default BlogPostPage;
```

### With Dynamic Paths

Combine JIT with `getStaticPaths` to pre-generate popular content:

```typescript
// app/products/[id]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

// Pre-generate top 100 products at build time
export const getStaticPaths = async () => {
  const topProducts = await fetchTopProducts(100);

  return {
    paths: topProducts.map(p => ({ params: { id: p.id } })),
    fallback: 'blocking'  // Generate other products on-demand
  };
};

export const getServerData = async (ctx: DataContext) => {
  const product = await fetchProduct(ctx.params.id);

  if (!product) {
    return { notFound: true };
  }

  const relatedProducts = await fetchRelatedProducts(product.category);

  return {
    props: { product, relatedProducts },
    cache: 'forever'  // Cache forever, invalidate when product updates
  };
};

const ProductPage: PageWithData<{
  product: Product;
  relatedProducts: Product[];
}> = ({ product, relatedProducts }) => {
  return (
    <div>
      <h1>{product.name}</h1>
      <p className="price">${product.price}</p>
      <div>{product.description}</div>

      <section>
        <h2>Related Products</h2>
        <div className="grid">
          {relatedProducts.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default ProductPage;
```

## Manual Cache Invalidation

### Revalidation API Endpoint

Create an API route to invalidate specific paths:

```typescript
// app/api/revalidate/route.ts
import { revalidatePath, revalidateTag } from 'veryfront';

export async function POST(request: Request) {
  const body = await request.json();
  const { path, tag, secret } = body;

  // Verify secret to prevent unauthorized invalidation
  if (secret !== Deno.env.get('REVALIDATE_SECRET')) {
    return Response.json(
      { message: 'Invalid secret' },
      { status: 401 }
    );
  }

  try {
    if (path) {
      // Invalidate specific path
      await revalidatePath(path);
      return Response.json({
        revalidated: true,
        path,
        timestamp: Date.now()
      });
    }

    if (tag) {
      // Invalidate all pages with this tag
      await revalidateTag(tag);
      return Response.json({
        revalidated: true,
        tag,
        timestamp: Date.now()
      });
    }

    return Response.json(
      { message: 'No path or tag provided' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Revalidation error:', error);
    return Response.json(
      { message: 'Error revalidating', error: String(error) },
      { status: 500 }
    );
  }
}
```

### Trigger Invalidation

Call the revalidation endpoint from your application:

```typescript
// Invalidate after updating a blog post
async function updateBlogPost(slug: string, data: BlogPostUpdate) {
  // Update the post in database
  await db.posts.update(slug, data);

  // Invalidate the cached page
  const secret = Deno.env.get('REVALIDATE_SECRET');
  await fetch('https://yoursite.com/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/blog/${slug}`,
      secret
    })
  });

  console.log(`Revalidated /blog/${slug}`);
}

// Invalidate after deleting a product
async function deleteProduct(id: string) {
  await db.products.delete(id);

  const secret = Deno.env.get('REVALIDATE_SECRET');
  await fetch('https://yoursite.com/api/revalidate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: `/products/${id}`,
      secret
    })
  });
}
```

## Cache Tags for Bulk Invalidation

Use cache tags to invalidate multiple related pages at once:

```typescript
// app/blog/[slug]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchBlogPost(ctx.params.slug);

  return {
    props: { post },
    cache: 'forever',
    tags: ['blog', `category:${post.category}`, `author:${post.authorId}`]
  };
};

// Invalidate all blog posts
await revalidateTag('blog');

// Invalidate all posts in a category
await revalidateTag('category:tutorials');

// Invalidate all posts by an author
await revalidateTag('author:123');
```

### Real-World Tag Example

```typescript
// app/products/[id]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  const product = await fetchProduct(ctx.params.id);

  return {
    props: { product },
    cache: 'forever',
    tags: [
      'products',
      `category:${product.category}`,
      `brand:${product.brand}`,
      `product:${product.id}`
    ]
  };
};

// Admin updates a product
async function adminUpdateProduct(id: string, updates: ProductUpdate) {
  await db.products.update(id, updates);

  // Invalidate this specific product
  await revalidateTag(`product:${id}`);

  // If category changed, invalidate both old and new categories
  if (updates.category) {
    await revalidateTag(`category:${updates.category}`);
  }
}

// Brand updates their info
async function updateBrand(brandId: string, updates: BrandUpdate) {
  await db.brands.update(brandId, updates);

  // Invalidate all products from this brand
  await revalidateTag(`brand:${brandId}`);
}
```

## Webhook Integration

Automatically invalidate when content changes in your CMS:

```typescript
// app/api/webhooks/cms/route.ts
import { revalidatePath, revalidateTag } from 'veryfront';

export async function POST(request: Request) {
  // Verify webhook signature
  const signature = request.headers.get('X-Webhook-Signature');
  const body = await request.text();

  if (!verifySignature(signature, body)) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const webhook = JSON.parse(body);

  switch (webhook.type) {
    case 'post.created':
    case 'post.updated':
      // Invalidate the specific post
      await revalidatePath(`/blog/${webhook.data.slug}`);

      // Invalidate the blog index
      await revalidatePath('/blog');

      // Invalidate category page
      await revalidateTag(`category:${webhook.data.category}`);
      break;

    case 'post.deleted':
      await revalidatePath(`/blog/${webhook.data.slug}`);
      await revalidatePath('/blog');
      break;

    case 'product.updated':
      await revalidateTag(`product:${webhook.data.id}`);
      break;

    case 'category.updated':
      // Invalidate all products in this category
      await revalidateTag(`category:${webhook.data.slug}`);
      break;

    default:
      console.log('Unknown webhook type:', webhook.type);
  }

  return Response.json({ success: true });
}

function verifySignature(signature: string | null, body: string): boolean {
  if (!signature) return false;

  const secret = Deno.env.get('WEBHOOK_SECRET');
  const crypto = new TextEncoder().encode(secret + body);
  // Implement your signature verification logic
  return true;
}
```

## Admin Dashboard Integration

Build an admin UI for content management with automatic invalidation:

```typescript
// app/admin/posts/[id]/edit/page.tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'veryfront';

export default function EditPostPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSave = async (formData: FormData) => {
    setSaving(true);

    try {
      // Update the post
      const response = await fetch(`/api/posts/${params.id}`, {
        method: 'PUT',
        body: formData
      });

      const updatedPost = await response.json();

      // Trigger revalidation
      await fetch('/api/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: `/blog/${updatedPost.slug}`,
          secret: getRevalidateSecret() // From admin session
        })
      });

      // Show success message
      alert('Post updated and cache invalidated!');

      // Redirect to the post
      router.push(`/blog/${updatedPost.slug}`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save post');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleSave(new FormData(e.currentTarget));
    }}>
      <input name="title" defaultValue={post?.title} required />
      <textarea name="content" defaultValue={post?.content} required />

      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Save & Publish'}
      </button>
    </form>
  );
}
```

### Bulk Revalidation UI

```typescript
// app/admin/cache/page.tsx
'use client';

import { useState } from 'react';

export default function CacheManagementPage() {
  const [revalidating, setRevalidating] = useState(false);
  const [result, setResult] = useState<string>('');

  const revalidateAll = async (tag: string) => {
    setRevalidating(true);
    setResult('');

    try {
      const response = await fetch('/api/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tag,
          secret: getAdminRevalidateSecret()
        })
      });

      const data = await response.json();
      setResult(`✅ Successfully invalidated tag: ${tag}`);
    } catch (error) {
      setResult(`❌ Failed to invalidate: ${error}`);
    } finally {
      setRevalidating(false);
    }
  };

  return (
    <div className="cache-management">
      <h1>Cache Management</h1>

      <section>
        <h2>Quick Actions</h2>
        <div className="actions">
          <button
            onClick={() => revalidateAll('blog')}
            disabled={revalidating}
          >
            Invalidate All Blog Posts
          </button>

          <button
            onClick={() => revalidateAll('products')}
            disabled={revalidating}
          >
            Invalidate All Products
          </button>

          <button
            onClick={() => revalidateAll('docs')}
            disabled={revalidating}
          >
            Invalidate All Documentation
          </button>
        </div>
      </section>

      {result && (
        <div className="result">
          {result}
        </div>
      )}

      <section>
        <h2>Custom Revalidation</h2>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const formData = new FormData(e.currentTarget);
          const path = formData.get('path') as string;

          setRevalidating(true);
          try {
            await fetch('/api/revalidate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                path,
                secret: getAdminRevalidateSecret()
              })
            });
            setResult(`✅ Successfully invalidated: ${path}`);
          } catch (error) {
            setResult(`❌ Failed: ${error}`);
          } finally {
            setRevalidating(false);
          }
        }}>
          <input
            name="path"
            placeholder="/blog/my-post"
            required
          />
          <button type="submit" disabled={revalidating}>
            Invalidate Path
          </button>
        </form>
      </section>
    </div>
  );
}

function getAdminRevalidateSecret(): string {
  // Get from admin session or auth token
  return sessionStorage.getItem('revalidate_secret') || '';
}
```

## Real-World Examples

### Example 1: Editorial Blog

Perfect for blogs where articles are published and rarely updated:

```typescript
// app/articles/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getStaticPaths = async () => {
  // Pre-generate recent articles at build time
  const recentArticles = await db.articles
    .where('status', '==', 'published')
    .orderBy('publishedAt', 'desc')
    .limit(50)
    .get();

  return {
    paths: recentArticles.map(a => ({ params: { slug: a.slug } })),
    fallback: 'blocking'
  };
};

export const getServerData = async (ctx: DataContext) => {
  const article = await db.articles
    .where('slug', '==', ctx.params.slug)
    .where('status', '==', 'published')
    .first();

  if (!article) {
    return { notFound: true };
  }

  const author = await db.users.get(article.authorId);
  const relatedArticles = await db.articles
    .where('category', '==', article.category)
    .where('id', '!=', article.id)
    .limit(3)
    .get();

  return {
    props: { article, author, relatedArticles },
    cache: 'forever',
    tags: [
      'articles',
      `category:${article.category}`,
      `author:${article.authorId}`,
      `article:${article.id}`
    ]
  };
};

const ArticlePage: PageWithData<{
  article: Article;
  author: User;
  relatedArticles: Article[];
}> = ({ article, author, relatedArticles }) => {
  return (
    <article>
      <header>
        <h1>{article.title}</h1>
        <div className="meta">
          <img src={author.avatar} alt={author.name} />
          <span>{author.name}</span>
          <time>{new Date(article.publishedAt).toLocaleDateString()}</time>
        </div>
      </header>

      <div
        className="content"
        dangerouslySetInnerHTML={{ __html: article.html }}
      />

      <aside>
        <h2>Related Articles</h2>
        {relatedArticles.map(a => (
          <ArticleCard key={a.id} article={a} />
        ))}
      </aside>
    </article>
  );
};

export default ArticlePage;
```

### Example 2: Product Catalog

E-commerce products that update when inventory or prices change:

```typescript
// app/shop/[category]/[product]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getStaticPaths = async () => {
  const products = await db.products.where('active', '==', true).get();

  return {
    paths: products.map(p => ({
      params: {
        category: p.category,
        product: p.slug
      }
    })),
    fallback: 'blocking'
  };
};

export const getServerData = async (ctx: DataContext) => {
  const product = await db.products
    .where('slug', '==', ctx.params.product)
    .where('category', '==', ctx.params.category)
    .first();

  if (!product) {
    return { notFound: true };
  }

  const reviews = await db.reviews
    .where('productId', '==', product.id)
    .orderBy('createdAt', 'desc')
    .limit(10)
    .get();

  const similarProducts = await db.products
    .where('category', '==', product.category)
    .where('id', '!=', product.id)
    .limit(4)
    .get();

  return {
    props: { product, reviews, similarProducts },
    cache: 'forever',
    tags: [
      'products',
      `category:${product.category}`,
      `product:${product.id}`
    ]
  };
};

const ProductPage: PageWithData<{
  product: Product;
  reviews: Review[];
  similarProducts: Product[];
}> = ({ product, reviews, similarProducts }) => {
  return (
    <div className="product-page">
      <div className="product-details">
        <img src={product.images[0]} alt={product.name} />
        <div>
          <h1>{product.name}</h1>
          <p className="price">${product.price}</p>
          <p className="stock">
            {product.stock > 0 ? 'In Stock' : 'Out of Stock'}
          </p>
          <button disabled={product.stock === 0}>Add to Cart</button>
        </div>
      </div>

      <section className="reviews">
        <h2>Customer Reviews</h2>
        {reviews.map(review => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </section>

      <section className="similar">
        <h2>Similar Products</h2>
        <div className="grid">
          {similarProducts.map(p => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
    </div>
  );
};

export default ProductPage;

// API route to update product and invalidate cache
// app/api/products/[id]/route.ts
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const updates = await request.json();

  // Update product
  await db.products.update(params.id, updates);

  // Get product to find its slug
  const product = await db.products.get(params.id);

  // Invalidate cache
  await revalidatePath(`/shop/${product.category}/${product.slug}`);
  await revalidateTag(`product:${params.id}`);

  return Response.json({ success: true });
}
```

### Example 3: Documentation Site

Technical documentation that updates when docs are edited:

```typescript
// app/docs/[...slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';
import { join } from '@std/path';
import { readTextFile } from '@std/fs';
import matter from 'gray-matter';
import { marked } from 'marked';

export const getStaticPaths = async () => {
  const docsDir = './content/docs';
  const paths: Array<{ params: { slug: string[] } }> = [];

  async function walk(dir: string, base: string[] = []) {
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        await walk(join(dir, entry.name), [...base, entry.name]);
      } else if (entry.name.endsWith('.md')) {
        const slug = [...base, entry.name.replace('.md', '')];
        paths.push({ params: { slug } });
      }
    }
  }

  await walk(docsDir);

  return {
    paths,
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext) => {
  const filePath = join(
    './content/docs',
    ...ctx.params.slug as string[],
    '.md'
  );

  try {
    const content = await readTextFile(filePath);
    const { data, content: markdown } = matter(content);
    const html = marked(markdown);

    // Get table of contents
    const headings = extractHeadings(markdown);

    return {
      props: {
        title: data.title,
        description: data.description,
        html,
        headings,
        lastUpdated: data.lastUpdated || null
      },
      cache: 'forever',
      tags: ['docs', `section:${ctx.params.slug[0]}`]
    };
  } catch (error) {
    return { notFound: true };
  }
};

const DocPage: PageWithData<{
  title: string;
  description: string;
  html: string;
  headings: Heading[];
  lastUpdated: string | null;
}> = ({ title, description, html, headings, lastUpdated }) => {
  return (
    <div className="doc-page">
      <aside className="toc">
        <h3>On This Page</h3>
        <nav>
          {headings.map(h => (
            <a
              key={h.id}
              href={`#${h.id}`}
              style={{ paddingLeft: `${(h.level - 2) * 16}px` }}
            >
              {h.text}
            </a>
          ))}
        </nav>
      </aside>

      <main>
        <header>
          <h1>{title}</h1>
          <p>{description}</p>
          {lastUpdated && (
            <p className="last-updated">
              Last updated: {new Date(lastUpdated).toLocaleDateString()}
            </p>
          )}
        </header>

        <div
          className="prose"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </main>
    </div>
  );
};

export default DocPage;

function extractHeadings(markdown: string): Heading[] {
  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  const headings: Heading[] = [];
  let match;

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    const text = match[2];
    const id = text.toLowerCase().replace(/[^\w]+/g, '-');
    headings.push({ level, text, id });
  }

  return headings;
}
```

## Performance Benefits

### Cache Hit Performance

```typescript
// First request (cache miss)
GET /blog/my-post
→ Execute getServerData()
→ Fetch from database
→ Render React components
→ Cache the result
→ Response time: ~200-500ms

// Subsequent requests (cache hit)
GET /blog/my-post
→ Serve from cache
→ Response time: ~10-50ms (10-50x faster!)
```

### Memory-Efficient Caching

Veryfront's JIT cache is optimized for memory efficiency:

```typescript
// Cached data structure (simplified)
{
  "/blog/my-post": {
    html: "<html>...</html>",
    headers: { "Content-Type": "text/html" },
    tags: ["blog", "category:tutorials"],
    cachedAt: 1704067200000
  }
}

// When memory limit reached, LRU eviction kicks in
// Least recently used pages are removed first
// Pages are regenerated on next request
```

## Best Practices

### 1. Use Descriptive Cache Tags

```typescript
// ❌ Bad: Generic tags
return {
  props: { data },
  cache: 'forever',
  tags: ['content']
};

// ✅ Good: Specific, hierarchical tags
return {
  props: { data },
  cache: 'forever',
  tags: [
    'blog',                    // Type
    `category:${post.category}`, // Category
    `author:${post.authorId}`,   // Author
    `post:${post.id}`            // Specific item
  ]
};
```

### 2. Secure Revalidation Endpoints

```typescript
// ✅ Always verify secret
export async function POST(request: Request) {
  const { secret, path } = await request.json();

  if (secret !== Deno.env.get('REVALIDATE_SECRET')) {
    return Response.json({ error: 'Invalid secret' }, { status: 401 });
  }

  await revalidatePath(path);
  return Response.json({ success: true });
}

// ✅ Rate limit revalidation requests
import { RateLimiter } from '@std/rate-limit';

const limiter = new RateLimiter({
  windowMs: 60000, // 1 minute
  max: 100 // 100 requests per minute
});

export async function POST(request: Request) {
  const ip = request.headers.get('X-Forwarded-For') || 'unknown';

  if (!limiter.check(ip)) {
    return Response.json(
      { error: 'Too many requests' },
      { status: 429 }
    );
  }

  // ... revalidation logic
}
```

### 3. Invalidate Strategically

```typescript
// ❌ Bad: Over-invalidating
async function updatePost(id: string, updates: PostUpdate) {
  await db.posts.update(id, updates);

  // Invalidates EVERYTHING - wasteful!
  await revalidateTag('blog');
}

// ✅ Good: Targeted invalidation
async function updatePost(id: string, updates: PostUpdate) {
  await db.posts.update(id, updates);

  // Only invalidate what changed
  await revalidateTag(`post:${id}`);

  // If category changed, invalidate both
  if (updates.category) {
    await revalidateTag(`category:${updates.oldCategory}`);
    await revalidateTag(`category:${updates.category}`);
  }
}
```

### 4. Handle Invalidation Errors

```typescript
// ✅ Graceful error handling
async function invalidatePost(slug: string) {
  try {
    const response = await fetch('/api/revalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: `/blog/${slug}`,
        secret: getRevalidateSecret()
      })
    });

    if (!response.ok) {
      console.error('Revalidation failed:', await response.text());
      // Log to error tracking service
      logError('revalidation_failed', { slug, status: response.status });
      return false;
    }

    return true;
  } catch (error) {
    console.error('Revalidation error:', error);
    logError('revalidation_error', { slug, error: String(error) });
    return false;
  }
}
```

### 5. Pre-Generate Important Content

```typescript
// ✅ Pre-generate critical pages at build time
export const getStaticPaths = async () => {
  // Homepage, popular posts, key landing pages
  const criticalPaths = [
    { params: { slug: 'getting-started' } },
    { params: { slug: 'installation' } },
    { params: { slug: 'quick-start' } }
  ];

  // Add top 50 most visited posts
  const topPosts = await analytics.getTopPosts(50);
  const topPostPaths = topPosts.map(p => ({
    params: { slug: p.slug }
  }));

  return {
    paths: [...criticalPaths, ...topPostPaths],
    fallback: 'blocking'
  };
};
```

## Monitoring & Debugging

### Cache Hit Rate Tracking

```typescript
// app/api/revalidate/route.ts
import { revalidatePath } from 'veryfront';

let revalidationCount = 0;
let lastReset = Date.now();

export async function POST(request: Request) {
  const { path, secret } = await request.json();

  if (secret !== Deno.env.get('REVALIDATE_SECRET')) {
    return Response.json({ error: 'Invalid' }, { status: 401 });
  }

  await revalidatePath(path);

  // Track revalidation
  revalidationCount++;

  // Log to analytics
  await logRevalidation({
    path,
    timestamp: Date.now(),
    totalToday: revalidationCount
  });

  return Response.json({
    success: true,
    path,
    revalidationCount
  });
}

// Reset counter daily
setInterval(() => {
  revalidationCount = 0;
  lastReset = Date.now();
}, 86400000);
```

### Debug Cache Status

```typescript
// Add debug headers in development
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post },
    cache: 'forever',
    tags: ['blog'],
    headers: Deno.env.get('NODE_ENV') === 'development' ? {
      'X-Cache-Status': 'MISS',
      'X-Cache-Tags': 'blog,post:123',
      'X-Cached-At': new Date().toISOString()
    } : undefined
  };
};
```

## Comparison with Other Rendering Modes

| Feature | JIT | ISR | SSG | SSR |
|---------|-----|-----|-----|-----|
| **First Request** | Generated | Pre-built | Pre-built | Generated |
| **Subsequent Requests** | Cached | Cached | Cached | Fresh |
| **Cache Duration** | Forever | Time-based | Forever | None |
| **Invalidation** | Manual | Automatic | Build only | N/A |
| **Control** | Complete | Limited | None | N/A |
| **Use Case** | Editorial content | Frequently updated | Static content | Dynamic data |
| **Performance** | Excellent after first hit | Excellent | Excellent | Variable |
| **Build Time** | Fast | Fast | Can be slow | N/A |
| **Memory Usage** | Low (LRU cache) | Low | None (static files) | None |

### When to Choose JIT vs ISR

**Choose JIT when:**
- Updates are infrequent and editor-controlled
- You want complete control over invalidation
- Content quality matters more than freshness
- You have an admin dashboard for content management

**Choose ISR when:**
- Content updates regularly (every hour/day)
- You can tolerate stale content for a short time
- Updates are predictable (e.g., every 15 minutes)
- You want automatic cache updates

**Example Decision Tree:**

```
Blog post that changes once per month
└─> JIT ✅ (manual invalidation when edited)

Product price that updates every hour
└─> ISR ✅ (revalidate: 3600)

News article that updates multiple times per day
└─> ISR with short revalidation ✅ (revalidate: 300)

Stock price that updates every second
└─> SSR ✅ (always fresh data)
```

## Advanced Patterns

### Pattern 1: Cascading Invalidation

Invalidate parent pages when child content changes:

```typescript
// app/api/posts/[id]/route.ts
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const updates = await request.json();
  const post = await db.posts.update(params.id, updates);

  // Invalidate the post itself
  await revalidatePath(`/blog/${post.slug}`);

  // Invalidate parent pages
  await revalidatePath('/blog');
  await revalidatePath(`/blog/category/${post.category}`);
  await revalidatePath(`/blog/author/${post.authorId}`);

  // Invalidate related posts (if they show this post)
  const related = await db.posts.where('relatedTo', 'array-contains', post.id).get();
  for (const relatedPost of related) {
    await revalidatePath(`/blog/${relatedPost.slug}`);
  }

  return Response.json({ success: true });
}
```

### Pattern 2: Conditional Cache Tags

Add tags based on content properties:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  const tags = [
    'blog',
    `post:${post.id}`,
    `category:${post.category}`,
    `author:${post.authorId}`
  ];

  // Add tag if post is featured
  if (post.featured) {
    tags.push('featured');
  }

  // Add tag if post has video
  if (post.videoUrl) {
    tags.push('videos');
  }

  // Add series tag if part of a series
  if (post.seriesId) {
    tags.push(`series:${post.seriesId}`);
  }

  return {
    props: { post },
    cache: 'forever',
    tags
  };
};

// Invalidate all featured posts
await revalidateTag('featured');

// Invalidate all posts with videos
await revalidateTag('videos');

// Invalidate entire series
await revalidateTag(`series:${seriesId}`);
```

### Pattern 3: Background Queue for Revalidation

Queue revalidation to avoid blocking API responses:

```typescript
// lib/revalidation-queue.ts
const queue: Array<{ type: 'path' | 'tag'; value: string }> = [];
let processing = false;

export function enqueueRevalidation(
  type: 'path' | 'tag',
  value: string
) {
  queue.push({ type, value });

  if (!processing) {
    processQueue();
  }
}

async function processQueue() {
  processing = true;

  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) break;

    try {
      if (item.type === 'path') {
        await revalidatePath(item.value);
      } else {
        await revalidateTag(item.value);
      }

      console.log(`Revalidated ${item.type}: ${item.value}`);
    } catch (error) {
      console.error(`Failed to revalidate ${item.type}:`, item.value, error);

      // Retry logic
      if (!item.retries || item.retries < 3) {
        queue.push({ ...item, retries: (item.retries || 0) + 1 });
      }
    }

    // Small delay between revalidations
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  processing = false;
}

// Usage in API routes
export async function PUT(request: Request) {
  const updates = await request.json();
  await db.posts.update(updates.id, updates);

  // Queue revalidation instead of blocking
  enqueueRevalidation('path', `/blog/${updates.slug}`);
  enqueueRevalidation('tag', `post:${updates.id}`);

  // Return immediately
  return Response.json({ success: true });
}
```

## Quick Reference

### JIT Configuration

```typescript
// Basic JIT
return {
  props: { data },
  cache: 'forever'
};

// JIT with tags
return {
  props: { data },
  cache: 'forever',
  tags: ['blog', `post:${id}`]
};

// JIT with custom headers
return {
  props: { data },
  cache: 'forever',
  tags: ['blog'],
  headers: {
    'X-Custom-Header': 'value'
  }
};
```

### Revalidation Functions

```typescript
import { revalidatePath, revalidateTag } from 'veryfront';

// Invalidate specific path
await revalidatePath('/blog/my-post');

// Invalidate with regex pattern
await revalidatePath('/blog/*');

// Invalidate by tag
await revalidateTag('blog');

// Invalidate multiple tags
await Promise.all([
  revalidateTag('blog'),
  revalidateTag('featured')
]);
```

### Common Cache Tag Patterns

```typescript
// Hierarchical tags
tags: [
  'content',                  // Top level
  'content:blog',             // Type
  'content:blog:tutorials',   // Category
  'content:blog:tutorials:123' // Specific
]

// Resource tags
tags: [
  `user:${userId}`,           // User content
  `team:${teamId}`,           // Team content
  `org:${orgId}`              // Organization content
]

// Time-based tags (for bulk operations)
tags: [
  'posts',
  `published:${year}`,        // Year
  `published:${year}-${month}` // Month
]
```

## Related Documentation

- [ISR (Incremental Static Regeneration)](./isr.md) - Time-based revalidation
- [SSG (Static Site Generation)](./ssg.md) - Build-time rendering
- [Rendering Mode Comparison](./comparison.md) - Compare all rendering modes
- [Revalidation API](/reference/functions/revalidation.md) - Complete API reference

## Summary

JIT (Just-In-Time) rendering is Veryfront's unique "cache forever until invalidated" strategy:

- ✅ **First request**: Generate on-demand (like SSR)
- ✅ **Subsequent requests**: Serve from cache (like SSG)
- ✅ **Cache duration**: Forever, until you invalidate it
- ✅ **Perfect for**: Editorial content, products, documentation
- ✅ **Complete control**: Manual invalidation via API
- ✅ **Performance**: Same speed as static after first render
- ✅ **Flexibility**: Update exactly when needed

Use JIT when you want complete control over cache invalidation, with the performance benefits of static generation and the flexibility of dynamic rendering.
