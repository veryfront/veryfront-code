---
title: Functions Reference
description: Complete reference for all server-side functions provided by Veryfront
category: reference
keywords: [functions, server-side, data-fetching, ssr, ssg, isr]
---

# Functions Reference

Server-side functions provided by Veryfront for data fetching, routing, page generation, and server-side logic.

## Available Functions

### Data Fetching

#### [getServerData](/reference/functions/get-server-data.md)

Fetch data on the server for SSR, SSG, ISR, or JIT rendering modes.

```typescript
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData(ctx.params.id);
  return { props: { data } };
};
```

**Key Features:**
- Server-side only execution
- Full request context (params, query, headers)
- Support for all rendering modes (SSR, SSG, ISR, JIT)
- TypeScript type safety
- Automatic serialization

**Use Cases:**
- Fetching API data
- Database queries
- Authentication checks
- Server-side computations
- Reading files

**Return Types:**
- Success with props: `{ props: { data } }`
- Not found: `{ notFound: true }`
- Redirect: `{ redirect: { destination, permanent } }`
- With revalidation: `{ props: { data }, revalidate: 3600 }`
- With caching: `{ props: { data }, cache: 'forever' }`

---

#### [getStaticPaths](/reference/functions/get-static-paths.md)

Define which dynamic route paths to pre-render at build time for static generation.

```typescript
export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false
  };
};
```

**Key Features:**
- Pre-render dynamic routes
- Build-time execution
- Multiple fallback modes
- Works with catch-all routes
- TypeScript type safety

**Use Cases:**
- Blog post generation
- Product page generation
- Documentation sites
- Static site generation
- Pre-rendering popular pages

**Fallback Modes:**
- `false` - 404 for unlisted paths
- `true` - Generate on-demand with loading UI
- `'blocking'` - SSR-like generation without loading UI

---

### Response Helpers

#### [notFound](/reference/functions/not-found.md)

Return a 404 Not Found response from server-side data fetching.

```typescript
import { notFound } from 'veryfront';

export const getServerData = async (ctx) => {
  const post = await fetchPost(ctx.params.slug);

  if (!post) {
    return notFound();
  }

  return { props: { post } };
};
```

**Key Features:**
- Clean 404 handling
- Triggers custom 404 page
- SEO friendly
- Works with getServerData and getStaticPaths

**Use Cases:**
- Missing resources
- Invalid parameters
- Unauthorized access
- Deleted content
- Draft posts

---

#### [redirect](/reference/functions/redirect.md)

Perform server-side redirects with support for temporary (302) and permanent (301) redirects.

```typescript
import { redirect } from 'veryfront';

export const getServerData = async (ctx) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  return { props: { user } };
};
```

**Key Features:**
- Server-side redirects
- 301 and 302 support
- Query parameter preservation
- Works before rendering

**Use Cases:**
- Authentication redirects
- URL migrations
- Locale detection
- Maintenance mode
- A/B testing

**Redirect Types:**
- Temporary: `redirect('/path')` or `redirect('/path', { permanent: false })`
- Permanent: `redirect('/path', { permanent: true })`

---

## Function Patterns

### Data Fetching Flow

```typescript
import type { DataContext } from 'veryfront';

interface PageProps {
  data: MyData;
}

// 1. Define data fetching
export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  // 2. Access context
  const { params, query, request, headers } = ctx;

  // 3. Fetch data
  const data = await fetchData(params.id);

  // 4. Handle errors
  if (!data) {
    return notFound();
  }

  // 5. Return props
  return {
    props: { data }
  };
};

// 6. Receive props in component
export default function Page({ data }: PageProps) {
  return <div>{data.title}</div>;
}
```

### Static Generation with Dynamic Routes

```typescript
import type { GetStaticPaths, DataContext } from 'veryfront';

// 1. Define which paths to generate
export const getStaticPaths: GetStaticPaths = async () => {
  const items = await fetchAllItems();

  return {
    paths: items.map(item => ({
      params: { id: item.id }
    })),
    fallback: 'blocking'
  };
};

// 2. Fetch data for each path
export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const item = await fetchItem(ctx.params.id);

  if (!item) {
    return { notFound: true };
  }

  return {
    props: { item },
    revalidate: 3600  // ISR: revalidate every hour
  };
};
```

### Error Handling

```typescript
import { notFound, redirect } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  try {
    // Validate input
    if (!isValidId(ctx.params.id)) {
      return notFound();
    }

    // Check authentication
    const user = await getUser(ctx.request);
    if (!user) {
      return redirect('/login');
    }

    // Check authorization
    const resource = await fetchResource(ctx.params.id);
    if (!resource) {
      return notFound();
    }

    if (!canAccess(user, resource)) {
      return redirect('/unauthorized');
    }

    // Return data
    return {
      props: { resource }
    };
  } catch (error) {
    console.error('Error:', error);
    throw error;  // Will show error page
  }
};
```

## Rendering Modes

### SSR (Server-Side Rendering)

Data is fetched on every request:

```typescript
export const getServerData = async (ctx) => {
  const data = await fetchLiveData();
  return { props: { data } };
};
```

**Best for:**
- Personalized content
- Real-time data
- User-specific pages

---

### SSG (Static Site Generation)

Data is fetched at build time:

```typescript
export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: [
      { params: { slug: 'post-1' } },
      { params: { slug: 'post-2' } }
    ],
    fallback: false
  };
};

export const getServerData = async (ctx) => {
  const data = await fetchData(ctx.params.slug);
  return { props: { data } };
};
```

**Best for:**
- Blogs
- Documentation
- Marketing pages
- Public content

---

### ISR (Incremental Static Regeneration)

Static pages that revalidate periodically:

```typescript
export const getServerData = async (ctx) => {
  const data = await fetchData();
  return {
    props: { data },
    revalidate: 3600  // Revalidate every hour
  };
};
```

**Best for:**
- E-commerce product pages
- News sites
- Content that updates regularly

---

### JIT (Just-In-Time)

Generate once, cache forever:

```typescript
export const getServerData = async (ctx) => {
  const data = await fetchData();
  return {
    props: { data },
    cache: 'forever'
  };
};
```

**Best for:**
- User-generated content
- Profile pages
- Archive pages

---

## Context API

All data fetching functions receive a context object:

```typescript
interface DataContext<Params = Record<string, string>> {
  params: Params;           // Route parameters
  query: URLSearchParams;   // Query string
  request: Request;         // Web Request object
  headers: Headers;         // Request headers
  url: URL;                 // Parsed URL
}
```

### Accessing Context

```typescript
export const getServerData = async (ctx: DataContext) => {
  // Route parameters (from /blog/[slug])
  const slug = ctx.params.slug;

  // Query parameters (from ?page=2)
  const page = ctx.query.get('page');

  // Request method
  const method = ctx.request.method;

  // Headers
  const userAgent = ctx.headers.get('user-agent');
  const cookies = ctx.headers.get('cookie');

  // URL
  const pathname = ctx.url.pathname;
  const origin = ctx.url.origin;

  // Use the data
  const data = await fetchData({ slug, page });

  return { props: { data } };
};
```

## TypeScript Support

All functions have full TypeScript support:

```typescript
import type { DataContext, GetStaticPaths } from 'veryfront';

// Typed params
type Params = {
  category: string;
  slug: string;
};

// Typed props
interface PageProps {
  post: Post;
  related: Post[];
}

export const getServerData = async (ctx: DataContext<Params>): Promise<{
  props: PageProps;
} | {
  notFound: true;
}> => {
  const post = await fetchPost(ctx.params.category, ctx.params.slug);

  if (!post) {
    return { notFound: true };
  }

  const related = await fetchRelated(post.id);

  return {
    props: {
      post,
      related
    }
  };
};
```

## Best Practices

### 1. Type Safety

```typescript
// Define param types
type Params = {
  id: string;
};

// Use typed context
export const getServerData = async (ctx: DataContext<Params>) => {
  // ctx.params.id is typed as string
  const data = await fetchData(ctx.params.id);
  return { props: { data } };
};
```

### 2. Error Handling

```typescript
export const getServerData = async (ctx) => {
  try {
    const data = await fetchData(ctx.params.id);

    if (!data) {
      return { notFound: true };
    }

    return { props: { data } };
  } catch (error) {
    console.error('Fetch error:', error);
    throw error;  // Shows error page
  }
};
```

### 3. Performance

```typescript
export const getServerData = async (ctx) => {
  // Fetch in parallel
  const [posts, categories] = await Promise.all([
    fetchPosts(),
    fetchCategories()
  ]);

  return {
    props: { posts, categories },
    revalidate: 3600  // Cache for 1 hour
  };
};
```

### 4. Security

```typescript
export const getServerData = async (ctx) => {
  // Environment variables are safe (not exposed to client)
  const apiKey = process.env.API_KEY;

  // Validate input
  if (!isValidId(ctx.params.id)) {
    return { notFound: true };
  }

  const data = await fetchSecureData(ctx.params.id, apiKey);

  // Don't expose sensitive data
  return {
    props: {
      data: {
        id: data.id,
        title: data.title
        // Don't include: data.secretKey
      }
    }
  };
};
```

## Related Documentation

- [Components Reference](/reference/components/) - React components
- [Hooks Reference](/reference/hooks/) - Client-side hooks
- [Data Fetching Guide](/reference/functions/README.md) - Data fetching patterns
- [Rendering Modes](/guides/rendering/README.md) - SSR, SSG, ISR, JIT explained

## Examples

- [Data Fetching Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/data-fetching-demo)
- [Static Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)
- [E-commerce with ISR](https://github.com/veryfrontjs/veryfront/tree/main/examples/full-demo)
- [Authentication Flow](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)
