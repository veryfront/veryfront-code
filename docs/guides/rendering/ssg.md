---
title: "Static Site Generation (SSG) Guide"
category: "rendering"
level: "beginner"
keywords: ["ssg", "static-site-generation", "build-time", "getStaticPaths", "jamstack"]
ai_summary: "Complete guide to Static Site Generation in Veryfront with build-time rendering, pre-generation, and JAMstack architecture"
related: ["rendering/comparison", "rendering/ssr", "rendering/isr", "rendering/jit"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Static Site Generation (SSG) Guide

Static Site Generation (SSG) generates HTML at **build time**. Pages are pre-rendered once during the build process and served as static files, providing the fastest possible performance.

## What is SSG?

SSG renders pages once at build time:

1. **Build starts** → Veryfront analyzes routes
2. **Data fetched** → For each page path
3. **React renders** → Components → HTML
4. **Static files created** → HTML, CSS, JS
5. **Deploy** → Upload to CDN/host
6. **User requests** → Static file served instantly

**Result:** Lightning-fast pages, perfect SEO, zero server processing per request.

---

## Why Use SSG?

### Perfect for:
- **Blogs** - Posts rarely change after publishing
- **Documentation** - Content updates infrequently
- **Marketing sites** - Landing pages, product pages
- **Portfolios** - Project showcases, galleries
- **Static content** - About pages, contact pages

### Advantages:
- ✅ **Blazing Fast** - Pre-built HTML, instant delivery
- ✅ **Perfect SEO** - Fully rendered HTML for crawlers
- ✅ **Zero Server Cost** - Static hosting (Netlify, Vercel, S3)
- ✅ **Global CDN** - Deploy worldwide, serve from edge
- ✅ **Rock Solid** - No database, no server failures

### Trade-offs:
- ❌ **Build Time** - Rebuilds for content updates
- ❌ **Stale Data** - Content frozen until next build
- ❌ **Large Sites** - Many pages = slow builds

**When to use:** Content that rarely changes, doesn't need per-user personalization.

---

## Getting Started

### Basic SSG Page

```typescript
// app/blog/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

// 1. Define which pages to pre-render
export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false  // 404 for unlisted slugs
  };
};

// 2. Fetch data for each page (runs at build time)
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post }
  };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <time>{post.publishedAt}</time>
      <div dangerouslySetInnerHTML={{ __html: post.html }} />
    </article>
  );
};

export default BlogPost;
```

**Build output:**
```
Building site...
✓ Generated /blog/hello-world
✓ Generated /blog/my-first-post
✓ Generated /blog/learning-veryfront
Build complete: 3 pages in 2.1s
```

---

## getStaticPaths

Defines which dynamic route paths to pre-generate.

### Basic Usage

```typescript
export const getStaticPaths = async () => {
  return {
    paths: [
      { params: { slug: 'hello-world' } },
      { params: { slug: 'second-post' } },
      { params: { slug: 'third-post' } }
    ],
    fallback: false
  };
};
```

**Generates:**
- `/blog/hello-world`
- `/blog/second-post`
- `/blog/third-post`

### From Database

```typescript
export const getStaticPaths = async () => {
  const posts = await db.query('SELECT slug FROM posts');

  return {
    paths: posts.rows.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false
  };
};
```

### From CMS/API

```typescript
export const getStaticPaths = async () => {
  const response = await fetch('https://api.example.com/posts');
  const posts = await response.json();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false
  };
};
```

### Multiple Parameters

```typescript
// app/docs/[category]/[slug]/page.tsx
export const getStaticPaths = async () => {
  const docs = await fetchAllDocs();

  return {
    paths: docs.map(doc => ({
      params: {
        category: doc.category,
        slug: doc.slug
      }
    })),
    fallback: false
  };
};
```

**Generates:**
- `/docs/getting-started/installation`
- `/guides/routing/dynamic-routes`
- `/reference/components`

---

## Fallback Options

### fallback: false

Only pre-generated paths exist. Other paths return 404.

```typescript
export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: false  // 404 for other slugs
  };
};
```

**Best for:** Small sites, complete content control.

### fallback: true

Unlisted paths render on-demand (first request), then cached.

```typescript
export const getStaticPaths = async () => {
  // Only pre-generate popular posts
  const popularPosts = await fetchPopularPosts({ limit: 10 });

  return {
    paths: popularPosts.map(p => ({ params: { slug: p.slug } })),
    fallback: true  // Generate other posts on first request
  };
};

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  if (!post) {
    return { notFound: true };  // Show 404 page
  }

  return { props: { post } };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  // Handle loading state for fallback pages
  if (!post) {
    return <LoadingSpinner />;
  }

  return <article>{/* ... */}</article>;
};
```

**Best for:** Large sites, lazy generation.

### fallback: 'blocking'

Unlisted paths render on-demand (first request blocks), then cached.

```typescript
export const getStaticPaths = async () => {
  const popularPosts = await fetchPopularPosts({ limit: 10 });

  return {
    paths: popularPosts.map(p => ({ params: { slug: p.slug } })),
    fallback: 'blocking'  // Generate on first request, block until ready
  };
};
```

**Best for:** No loading state needed, server-side rendering on first request.

---

## Data Fetching

### From Database

```typescript
// app/posts/[id]/page.tsx
export const getStaticPaths = async () => {
  const posts = await db.query('SELECT id FROM posts');

  return {
    paths: posts.rows.map(post => ({
      params: { id: post.id.toString() }
    })),
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext) => {
  const post = await db.query(
    'SELECT * FROM posts WHERE id = $1',
    [ctx.params.id]
  );

  return {
    props: { post: post.rows[0] }
  };
};
```

### From Markdown Files

```typescript
import { readDir, readTextFile } from '@std/fs';
import { join } from '@std/path';
import matter from 'gray-matter';
import { marked } from 'marked';

export const getStaticPaths = async () => {
  const postsDir = './content/posts';
  const files = await readDir(postsDir);

  const paths = files
    .filter(f => f.name.endsWith('.md'))
    .map(f => ({
      params: { slug: f.name.replace('.md', '') }
    }));

  return { paths, fallback: false };
};

export const getServerData = async (ctx: DataContext) => {
  const filePath = join('./content/posts', `${ctx.params.slug}.md`);
  const fileContent = await readTextFile(filePath);

  const { data, content } = matter(fileContent);
  const html = marked(content);

  return {
    props: {
      title: data.title,
      date: data.date,
      html
    }
  };
};
```

### From Headless CMS

```typescript
export const getStaticPaths = async () => {
  const response = await fetch('https://cms.example.com/api/posts');
  const posts = await response.json();

  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext) => {
  const response = await fetch(
    `https://cms.example.com/api/posts/${ctx.params.slug}`
  );
  const post = await response.json();

  return { props: { post } };
};
```

### From Multiple Sources

```typescript
export const getServerData = async (ctx: DataContext) => {
  const [post, author, related] = await Promise.all([
    fetchPost(ctx.params.slug),
    fetchAuthor(ctx.params.slug),
    fetchRelatedPosts(ctx.params.slug, { limit: 3 })
  ]);

  return {
    props: { post, author, related }
  };
};
```

---

## Markdown Blog Example

Complete blog with markdown content.

### Directory Structure

```
content/
├── posts/
│   ├── hello-world.md
│   ├── second-post.md
│   └── third-post.md
app/
├── blog/
│   ├── page.tsx          # Blog index
│   └── [slug]/
│       └── page.tsx      # Blog post
```

### Markdown Files

```markdown
---
title: "Hello World"
date: "2025-01-15"
excerpt: "My first blog post"
---

# Hello World

This is my first blog post!
```

### Blog Index Page

```typescript
// app/blog/page.tsx
import type { PageWithData } from 'veryfront';
import { readDir, readTextFile } from '@std/fs';
import matter from 'gray-matter';

export const getServerData = async () => {
  const postsDir = './content/posts';
  const files = await readDir(postsDir);

  const posts = await Promise.all(
    files
      .filter(f => f.name.endsWith('.md'))
      .map(async file => {
        const content = await readTextFile(
          join(postsDir, file.name)
        );
        const { data } = matter(content);

        return {
          slug: file.name.replace('.md', ''),
          title: data.title,
          date: data.date,
          excerpt: data.excerpt
        };
      })
  );

  // Sort by date, newest first
  posts.sort((a, b) =>
    new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return { props: { posts } };
};

const BlogIndex: PageWithData<{ posts: Post[] }> = ({ posts }) => {
  return (
    <div>
      <h1>Blog</h1>
      {posts.map(post => (
        <article key={post.slug}>
          <h2>
            <Link href={`/blog/${post.slug}`}>{post.title}</Link>
          </h2>
          <time>{post.date}</time>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </div>
  );
};

export default BlogIndex;
```

### Blog Post Page

```typescript
// app/blog/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';
import { readDir, readTextFile } from '@std/fs';
import matter from 'gray-matter';
import { marked } from 'marked';

export const getStaticPaths = async () => {
  const postsDir = './content/posts';
  const files = await readDir(postsDir);

  const paths = files
    .filter(f => f.name.endsWith('.md'))
    .map(f => ({
      params: { slug: f.name.replace('.md', '') }
    }));

  return { paths, fallback: false };
};

export const getServerData = async (ctx: DataContext) => {
  const filePath = join('./content/posts', `${ctx.params.slug}.md`);
  const fileContent = await readTextFile(filePath);

  const { data, content } = matter(fileContent);
  const html = marked(content);

  return {
    props: {
      title: data.title,
      date: data.date,
      html
    }
  };
};

const BlogPost: PageWithData<{
  title: string;
  date: string;
  html: string;
}> = ({ title, date, html }) => {
  return (
    <article>
      <h1>{title}</h1>
      <time>{date}</time>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </article>
  );
};

export default BlogPost;
```

---

## Documentation Site Example

Multi-level documentation with categories.

```typescript
// app/docs/[category]/[slug]/page.tsx
export const getStaticPaths = async () => {
  const docsDir = './content/docs';
  const categories = await readDir(docsDir);

  const paths = [];

  for (const category of categories) {
    if (!category.isDirectory) continue;

    const categoryPath = join(docsDir, category.name);
    const files = await readDir(categoryPath);

    for (const file of files) {
      if (file.name.endsWith('.md')) {
        paths.push({
          params: {
            category: category.name,
            slug: file.name.replace('.md', '')
          }
        });
      }
    }
  }

  return { paths, fallback: false };
};

export const getServerData = async (ctx: DataContext) => {
  const { category, slug } = ctx.params;
  const filePath = join('./content/docs', category, `${slug}.md`);

  const fileContent = await readTextFile(filePath);
  const { data, content } = matter(fileContent);
  const html = marked(content);

  return {
    props: {
      title: data.title,
      category,
      html
    }
  };
};
```

---

## Build Optimization

### Incremental Builds

Only rebuild changed pages:

```typescript
// veryfront.config.ts
export default {
  build: {
    incremental: true,  // Only rebuild changed pages
    cache: true         // Cache build artifacts
  }
};
```

### Parallel Builds

Build multiple pages simultaneously:

```typescript
export default {
  build: {
    parallel: true,
    workers: 4  // Number of concurrent builds
  }
};
```

### Limit Pre-generation

For large sites, only pre-generate important pages:

```typescript
export const getStaticPaths = async () => {
  if (process.env.NODE_ENV === 'production') {
    // Production: Generate all pages
    const posts = await fetchAllPosts();
    return {
      paths: posts.map(p => ({ params: { slug: p.slug } })),
      fallback: 'blocking'
    };
  } else {
    // Development: Only generate recent posts
    const recentPosts = await fetchRecentPosts({ limit: 5 });
    return {
      paths: recentPosts.map(p => ({ params: { slug: p.slug } })),
      fallback: 'blocking'
    };
  }
};
```

---

## SEO Optimization

### Metadata

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post },
    head: {
      title: post.title,
      description: post.excerpt,
      openGraph: {
        title: post.title,
        description: post.excerpt,
        image: post.coverImage,
        type: 'article',
        publishedTime: post.publishedAt,
        author: post.author.name
      },
      twitter: {
        card: 'summary_large_image',
        title: post.title,
        description: post.excerpt,
        image: post.coverImage
      }
    }
  };
};
```

### Sitemap Generation

```typescript
// scripts/generate-sitemap.ts
import { writeTextFile } from '@std/fs';

const posts = await fetchAllPosts();

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <priority>1.0</priority>
  </url>
  ${posts.map(post => `
  <url>
    <loc>https://example.com/blog/${post.slug}</loc>
    <lastmod>${post.updatedAt}</lastmod>
    <priority>0.8</priority>
  </url>
  `).join('')}
</urlset>`;

await writeTextFile('./public/sitemap.xml', sitemap);
```

### RSS Feed

```typescript
// app/rss.xml/route.ts
export async function GET() {
  const posts = await fetchAllPosts();

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>My Blog</title>
    <link>https://example.com</link>
    <description>Blog description</description>
    ${posts.map(post => `
    <item>
      <title>${post.title}</title>
      <link>https://example.com/blog/${post.slug}</link>
      <description>${post.excerpt}</description>
      <pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>
    </item>
    `).join('')}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: { 'Content-Type': 'application/xml' }
  });
}
```

---

## Deployment

### Build Command

```bash
# Build static site
veryfront build

# Output directory: .veryfront/build
```

### Deploy to Deno Deploy

```bash
deployctl deploy --project=my-blog
```

### Deploy to Netlify

```toml
# netlify.toml
[build]
  command = "veryfront build"
  publish = ".veryfront/build"
```

### Deploy to Vercel

```json
{
  "buildCommand": "veryfront build",
  "outputDirectory": ".veryfront/build"
}
```

### Deploy to S3 + CloudFront

```bash
# Build
veryfront build

# Upload to S3
aws s3 sync .veryfront/build s3://my-bucket

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
  --distribution-id YOUR_DIST_ID \
  --paths "/*"
```

---

## Best Practices

### 1. Use ISR for Semi-Dynamic Content

If content updates occasionally, consider ISR instead:

```typescript
// SSG: Rebuild entire site for updates
export const getStaticPaths = async () => { /* ... */ };

// ISR: Automatic revalidation every hour
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  return {
    props: { post },
    revalidate: 3600  // Use ISR instead
  };
};
```

### 2. Optimize Images

```typescript
import { OptimizedImage } from 'veryfront';

<OptimizedImage
  src={post.coverImage}
  alt={post.title}
  width={1200}
  height={630}
  priority  // Preload above-the-fold images
/>
```

### 3. Code Splitting

```typescript
import dynamic from 'veryfront/dynamic';

const Comments = dynamic(() => import('./Comments'), {
  loading: () => <p>Loading comments...</p>,
  ssr: false  // Don't render during build
});
```

### 4. Prefetch Links

```typescript
import { Link } from 'veryfront';

<Link href="/blog/next-post" prefetch>
  Next Post
</Link>
```

---

## SSG vs Other Rendering Modes

| Feature | SSG | SSR | ISR | JIT |
|---------|-----|-----|-----|-----|
| **Build Time** | High | None | Medium | Low |
| **Response Time** | Instant | Medium | Instant | Instant |
| **Data Freshness** | Stale | Always fresh | Periodic | On-demand |
| **Server Cost** | None | High | Low | Low |
| **Use Case** | Static content | Dynamic data | Semi-dynamic | Rare updates |

**Choose SSG when:**
- Content rarely changes
- Build time acceptable
- Maximum performance needed
- Zero server cost desired

**Consider alternatives when:**
- Content changes frequently → SSR
- Content updates periodically → ISR
- Content updates on-demand → JIT

---

## Related Documentation

- [Rendering Comparison](./comparison.md) - Choose the right mode
- [SSR Guide](./ssr.md) - Server-Side Rendering
- [ISR Guide](./isr.md) - Incremental Static Regeneration
- [JIT Guide](./jit.md) - Just-In-Time Rendering
- [Data Fetching API](/reference/functions/get-server-data.md) - Complete reference

---

## Examples

- [Blog Example](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - Markdown blog with SSG
- [Documentation](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - Multi-level docs
- [Portfolio](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-app-router) - Static portfolio site

---

## Quick Reference

### Basic SSG
```typescript
export const getStaticPaths = async () => {
  const items = await fetchAll();
  return {
    paths: items.map(i => ({ params: { id: i.id } })),
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext) => {
  const item = await fetch(ctx.params.id);
  return { props: { item } };
};
```

### With Fallback
```typescript
return {
  paths: popularPaths,
  fallback: 'blocking'  // or true
};
```

### Build & Deploy
```bash
veryfront build
deployctl deploy --project=my-site
```
