---
title: "Dynamic Routes"
category: "routing"
level: "intermediate"
keywords: ["dynamic", "routes", "params", "slug", "routing", "parameters"]
ai_summary: "Create dynamic routes with URL parameters using [slug] syntax in both App Router and Pages Router"
related: ["routing/app-router", "routing/pages-router", "api/routes"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Dynamic Routes

Dynamic routes allow you to create pages that respond to variable URL segments. Use them for blog posts, product pages, user profiles, and any content with unique identifiers.

## Overview

Veryfront supports three types of dynamic segments:

- **Single segment**: `[slug]` - Matches one segment (e.g., `/blog/hello-world`)
- **Catch-all**: `[...slug]` - Matches multiple segments (e.g., `/reference/routes`)
- **Optional catch-all**: `[[...slug]]` - Matches zero or more segments

Both App Router and Pages Router support dynamic routes with the same syntax.

## Basic Example (App Router)

Create a file with square brackets in the name:

**File:** `app/blog/[slug]/page.tsx`

```typescript
import type { PageWithData, DataContext } from 'veryfront';

// Fetch data based on the dynamic parameter
export const getServerData = async (ctx: DataContext) => {
  const { slug } = ctx.params;
  const post = await fetchPost(slug);

  if (!post) {
    return { notFound: true };
  }

  return { props: { post } };
};

// TypeScript automatically infers the type
const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <div>{post.content}</div>
    </article>
  );
};

export default BlogPost;
```

**URL:** `/blog/my-first-post` → `ctx.params.slug === "my-first-post"`

## Basic Example (Pages Router)

**File:** `pages/blog/[slug].tsx`

```typescript
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug as string);
  return { props: { post } };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return <article><h1>{post.title}</h1></article>;
};

export default BlogPost;
```

## Catch-All Routes

Match multiple URL segments:

**File:** `app/docs/[...slug]/page.tsx`

```typescript
export const getServerData = async (ctx: DataContext) => {
  // slug is an array of segments
  const { slug } = ctx.params; // string[]

  // /reference/routes → slug = ["api", "routes"]
  // /docs/getting-started → slug = ["getting-started"]

  const doc = await fetchDocByPath(slug.join('/'));
  return { props: { doc } };
};
```

## Optional Catch-All Routes

Match zero or more segments:

**File:** `app/shop/[[...categories]]/page.tsx`

```typescript
export const getServerData = async (ctx: DataContext) => {
  const categories = ctx.params.categories || [];

  // /shop → categories = []
  // /shop/electronics → categories = ["electronics"]
  // /shop/electronics/phones → categories = ["electronics", "phones"]

  const products = await fetchProducts(categories);
  return { props: { products } };
};
```

## Multiple Dynamic Segments

Combine multiple parameters:

**File:** `app/[category]/[product]/page.tsx`

```typescript
export const getServerData = async (ctx: DataContext) => {
  const { category, product } = ctx.params;
  // Both are available as strings

  const data = await fetchProduct(category, product);
  return { props: { data } };
};
```

**URL:** `/electronics/laptop` → `category = "electronics"`, `product = "laptop"`

## Static Generation

Pre-render dynamic routes at build time:

```typescript
import type { GetStaticPaths } from 'veryfront';

// Tell Veryfront which paths to pre-render
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false, // 404 for unknown slugs
  };
};

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug as string);
  return { props: { post } };
};
```

## TypeScript Types

Veryfront provides full type safety for dynamic parameters:

```typescript
import type { PageWithData, DataContext } from 'veryfront';

// Params are typed automatically based on file structure
type Params = {
  slug: string;           // [slug]
  categories: string[];   // [...categories]
};

export const getServerData = async (ctx: DataContext<Params>) => {
  // ctx.params.slug is typed as string
  // ctx.params.categories is typed as string[]
};
```

## Common Patterns

### Blog with Categories

```
app/blog/
├── page.tsx              → /blog (list all)
├── [category]/
│   ├── page.tsx          → /blog/tutorials (category list)
│   └── [slug]/
│       └── page.tsx      → /blog/tutorials/my-post
```

### User Profiles

```
app/users/
└── [username]/
    ├── page.tsx          → /users/john (profile)
    ├── posts/
    │   └── page.tsx      → /users/john/posts
    └── settings/
        └── page.tsx      → /users/john/settings
```

### Documentation Site

```
app/docs/
├── page.tsx              → /docs (home)
└── [...slug]/
    └── page.tsx          → /docs/any/path/here
```

## API Routes with Dynamic Segments

Works the same for API routes:

**File:** `app/api/posts/[id]/route.ts`

```typescript
import type { APIHandler } from 'veryfront';

export const GET: APIHandler = async (ctx) => {
  const { id } = ctx.params;
  const post = await db.posts.findById(id);

  return Response.json({ post });
};

export const DELETE: APIHandler = async (ctx) => {
  const { id } = ctx.params;
  await db.posts.delete(id);

  return Response.json({ success: true });
};
```

## Error Handling

```typescript
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug as string);

  // Return 404 if not found
  if (!post) {
    return { notFound: true };
  }

  // Redirect if moved
  if (post.redirectTo) {
    return {
      redirect: {
        destination: `/blog/${post.redirectTo}`,
        permanent: true,
      },
    };
  }

  return { props: { post } };
};
```

## Rendering Modes

Dynamic routes work with all rendering modes:

| Mode | Use Case | Example |
|------|----------|---------|
| **SSR** | Real-time data | User dashboard |
| **SSG** | Static content | Blog posts (with getStaticPaths) |
| **ISR** | Periodically updated | Product pages |
| **JIT** | Large-scale sites | Docs with 100k+ pages |

See [Rendering Modes](/guides/rendering/comparison.md) for details.

## Priority Rules

When multiple routes could match, Veryfront uses this priority:

1. Static routes (`/blog/about`)
2. Dynamic routes (`/blog/[slug]`)
3. Catch-all routes (`/blog/[...slug]`)

**Example:**
```
/blog/about            → Matches blog/about/page.tsx (static)
/blog/my-post          → Matches blog/[slug]/page.tsx (dynamic)
/blog/category/tech    → Matches blog/[...slug]/page.tsx (catch-all)
```

## Best Practices

1. **Use descriptive parameter names**: `[slug]`, `[id]`, `[username]` (not `[param]`)
2. **Validate parameters**: Check format and existence before querying database
3. **Handle not found**: Return `{ notFound: true }` for invalid parameters
4. **Type your params**: Use TypeScript for type safety
5. **Consider SEO**: Use meaningful slugs, not just IDs

## Common Errors

### "params is undefined"

Make sure you're accessing params from the DataContext:

```typescript
// ❌ Wrong
const slug = params.slug;

// ✅ Correct
export const getServerData = async (ctx: DataContext) => {
  const slug = ctx.params.slug;
};
```

### "slug is an array when I expected a string"

You used `[...slug]` (catch-all) instead of `[slug]`:

```typescript
// File: [slug]/page.tsx → slug is a string
// File: [...slug]/page.tsx → slug is a string[]
```

### "Cannot read property 'x' of undefined"

Dynamic params might be undefined on optional catch-all routes:

```typescript
// File: [[...slug]]/page.tsx
export const getServerData = async (ctx: DataContext) => {
  // Handle undefined case
  const segments = ctx.params.slug || [];
};
```

## Related Documentation

- [App Router](./app-router.md) - App Router overview
- [Pages Router](./pages-router.md) - Pages Router overview
- [API Routes](./api-routes.md) - API endpoints with dynamic segments
- [Static Generation](/guides/rendering/ssg.md) - Pre-rendering dynamic routes
- [Data Fetching](/reference/functions/get-server-data.md) - getServerData and getStaticPaths APIs

## Examples

See working examples:
- [Blog Example](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx) - Dynamic blog with categories
- [Documentation Site](https://github.com/veryfront/veryfront/tree/main/examples/basic-mdx) - Catch-all routes
- [E-commerce](https://github.com/veryfront/veryfront/tree/main/examples/full-demo) - Products with dynamic routes
