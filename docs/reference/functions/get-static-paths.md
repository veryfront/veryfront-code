---
title: getStaticPaths
description: Define which dynamic route paths to pre-render at build time for static generation
category: reference
type: function
keywords: [ssg, static-generation, dynamic-routes, pre-rendering, getStaticPaths]
related: [/reference/functions/get-server-data.md, /reference/functions/not-found.md]
---

# getStaticPaths

Define which dynamic route paths to pre-render at build time for static generation (SSG). This function is required for dynamic routes that use Static Site Generation.

## Syntax

```typescript
import type { GetStaticPaths } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [
      { params: { slug: 'first-post' } },
      { params: { slug: 'second-post' } }
    ],
    fallback: false
  };
};
```

## Parameters

The function takes no parameters and should return a `GetStaticPathsResult` object.

## Return Value

Returns a promise that resolves to an object with the following structure:

```typescript
interface GetStaticPathsResult {
  paths: Array<{
    params: Record<string, string | string[]>;
  }>;
  fallback: boolean | 'blocking';
}
```

### Return Object Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| paths | Array<{ params }> | Yes | Array of path objects with params for each page to pre-render |
| fallback | boolean \| 'blocking' | Yes | How to handle paths not in the paths array |

### Fallback Modes

| Mode | Behavior |
|------|----------|
| `false` | Return 404 for any path not returned by `getStaticPaths` |
| `true` | Show fallback UI while generating page, then cache result |
| `'blocking'` | Wait for page generation without showing fallback UI (SSR-like) |

## Examples

### Basic Static Paths

```typescript
import type { GetStaticPaths, DataContext } from 'veryfront';

// Define which paths to pre-render
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetch('https://api.example.com/posts')
    .then(res => res.json());

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false
  };
};

// Fetch data for each path
export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetch(
    `https://api.example.com/posts/${ctx.params.slug}`
  ).then(res => res.json());

  return {
    props: {
      post
    }
  };
};

export default function BlogPost({ post }) {
  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
}
```

### With Fallback True

Generate pages on-demand after build:

```typescript
import type { GetStaticPaths } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  // Only pre-render most popular posts
  const popularPosts = await fetch('https://api.example.com/posts?popular=true')
    .then(res => res.json());

  return {
    paths: popularPosts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: true  // Other posts generated on-demand
  };
};

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetch(
    `https://api.example.com/posts/${ctx.params.slug}`
  ).then(res => res.json());

  if (!post) {
    return { notFound: true };
  }

  return {
    props: {
      post
    }
  };
};

export default function BlogPost({ post }) {
  // Show loading state while generating
  if (!post) {
    return <div>Loading...</div>;
  }

  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
}
```

### With Fallback Blocking

Generate pages on-demand without showing loading UI:

```typescript
import type { GetStaticPaths } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  // Pre-render a subset of pages
  const recentPosts = await fetch('https://api.example.com/posts?limit=10')
    .then(res => res.json());

  return {
    paths: recentPosts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: 'blocking'  // SSR-like behavior for other pages
  };
};

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetch(
    `https://api.example.com/posts/${ctx.params.slug}`
  ).then(res => res.json());

  if (!post) {
    return { notFound: true };
  }

  return {
    props: {
      post
    }
  };
};

export default function BlogPost({ post }) {
  // No loading state needed - page waits for data
  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
}
```

### Multiple Dynamic Segments

```typescript
import type { GetStaticPaths } from 'veryfront';

// For route: /blog/[category]/[slug]
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetch('https://api.example.com/posts')
    .then(res => res.json());

  return {
    paths: posts.map(post => ({
      params: {
        category: post.category,
        slug: post.slug
      }
    })),
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext<{
  category: string;
  slug: string;
}>) => {
  const { category, slug } = ctx.params;

  const post = await fetch(
    `https://api.example.com/posts/${category}/${slug}`
  ).then(res => res.json());

  return {
    props: {
      post
    }
  };
};
```

### Catch-All Routes

```typescript
import type { GetStaticPaths } from 'veryfront';

// For route: /docs/[...slug]
export const getStaticPaths: GetStaticPaths = async () => {
  const pages = [
    { slug: ['getting-started'] },
    { slug: ['api', 'introduction'] },
    { slug: ['api', 'reference', 'functions'] }
  ];

  return {
    paths: pages.map(page => ({
      params: { slug: page.slug }
    })),
    fallback: false
  };
};

export const getServerData = async (ctx: DataContext<{
  slug: string[];
}>) => {
  const path = ctx.params.slug.join('/');

  const content = await fetch(
    `https://api.example.com/docs/${path}`
  ).then(res => res.json());

  return {
    props: {
      content
    }
  };
};
```

### Reading from File System

```typescript
import type { GetStaticPaths } from 'veryfront';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const getStaticPaths: GetStaticPaths = async () => {
  // Read markdown files from disk
  const postsDirectory = join(process.cwd(), 'content/posts');
  const filenames = await readdir(postsDirectory);

  return {
    paths: filenames
      .filter(filename => filename.endsWith('.md'))
      .map(filename => ({
        params: {
          slug: filename.replace(/\.md$/, '')
        }
      })),
    fallback: false
  };
};
```

### With Database Query

```typescript
import type { GetStaticPaths } from 'veryfront';
import { db } from '@/lib/database';

export const getStaticPaths: GetStaticPaths = async () => {
  const products = await db.product.findMany({
    select: {
      slug: true
    }
  });

  return {
    paths: products.map(product => ({
      params: {
        slug: product.slug
      }
    })),
    fallback: 'blocking'
  };
};
```

### Combining with ISR

```typescript
import type { GetStaticPaths, DataContext } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  // Pre-render only top 100 products
  const topProducts = await fetch(
    'https://api.example.com/products?top=100'
  ).then(res => res.json());

  return {
    paths: topProducts.map(product => ({
      params: { id: product.id }
    })),
    fallback: 'blocking'
  };
};

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const product = await fetch(
    `https://api.example.com/products/${ctx.params.id}`
  ).then(res => res.json());

  if (!product) {
    return { notFound: true };
  }

  return {
    props: {
      product
    },
    revalidate: 3600  // Revalidate every hour
  };
};
```

### Empty Paths with Fallback

Pre-render nothing at build time, generate everything on-demand:

```typescript
import type { GetStaticPaths } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [],  // No pages pre-rendered
    fallback: 'blocking'  // All pages generated on first request
  };
};

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const user = await fetch(
    `https://api.example.com/users/${ctx.params.id}`
  ).then(res => res.json());

  if (!user) {
    return { notFound: true };
  }

  return {
    props: {
      user
    }
  };
};
```

## Behavior

- **Build-time execution**: Runs once during the build process
- **Required for SSG**: Must be exported for dynamic routes using SSG
- **Works with getServerData**: Used together to generate static pages
- **Caching**: Generated pages are cached and served as static files

## When to Use Each Fallback Mode

### Use `fallback: false` when:
- You have a small, fixed set of paths
- All paths are known at build time
- You want 404 for unknown paths

### Use `fallback: true` when:
- You have many paths but want to pre-render only popular ones
- You can show a loading state
- New paths are frequently added

### Use `fallback: 'blocking'` when:
- You have many paths but want to pre-render only some
- You cannot show a loading state
- You want SSR-like behavior for unpre-rendered paths

## Notes

- Only works with dynamic routes (e.g., `[slug].tsx`, `[...slug].tsx`)
- Must be used with `getServerData` for SSG
- Cannot access request-specific data (no cookies, headers, etc.)
- The function name must be exactly `getStaticPaths`
- Paths are case-sensitive
- For catch-all routes, params must be an array

## Related

- [getServerData](/reference/functions/get-server-data.md) - Fetch data for each path
- [notFound](/reference/functions/not-found.md) - Return 404 for invalid paths
- [redirect](/reference/functions/redirect.md) - Redirect from paths
