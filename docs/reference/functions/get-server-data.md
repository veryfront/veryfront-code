---
title: getServerData
description: Server-side data fetching function for SSR, SSG, ISR, and JIT rendering modes
category: reference
type: function
keywords: [data-fetching, ssr, ssg, isr, jit, server-side, getServerData]
related: [/reference/functions/get-static-paths.md, /reference/functions/not-found.md, /reference/functions/redirect.md]
---

# getServerData

Server-side data fetching function for SSR, SSG, ISR, and JIT rendering modes. This function runs exclusively on the server and allows you to fetch data before rendering your page.

## Syntax

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // Fetch your data
  const data = await fetchData();

  // Return props
  return { props: { data } };
};
```

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| ctx | DataContext | Yes | Context object containing request information |

### DataContext Interface

```typescript
interface DataContext<Params = Record<string, string>> {
  params: Params;           // URL parameters from dynamic routes
  query: URLSearchParams;   // Query string parameters
  request: Request;         // Web standard Request object
  headers: Headers;         // Request headers
  url: URL;                // Parsed URL object
}
```

#### Context Properties

| Property | Type | Description |
|----------|------|-------------|
| params | Record<string, string \| string[]> | Dynamic route parameters (e.g., `{ slug: 'my-post' }` for `/blog/[slug]`) |
| query | URLSearchParams | Query string parameters from the URL |
| request | Request | Standard Web Request object with method, headers, body, etc. |
| headers | Headers | Request headers for accessing cookies, user-agent, etc. |
| url | URL | Parsed URL object with pathname, search, hash, etc. |

## Return Value

The function returns a promise that resolves to one of the following response types:

### Success Response

```typescript
{
  props: {
    // Your data here
  }
}
```

### Not Found Response

```typescript
{
  notFound: true
}
```

### Redirect Response

```typescript
{
  redirect: {
    destination: string;
    permanent: boolean;  // true for 301, false for 302
  }
}
```

### With ISR (Incremental Static Regeneration)

```typescript
{
  props: { data },
  revalidate: number  // Seconds until revalidation
}
```

### With JIT Caching

```typescript
{
  props: { data },
  cache: 'forever'  // Cache permanently
}
```

### With Custom Headers

```typescript
{
  props: { data },
  headers: {
    'Cache-Control': 'public, max-age=60',
    'X-Custom-Header': 'value'
  }
}
```

## Examples

### Basic Data Fetching

```typescript
import type { DataContext } from 'veryfront';

interface PageProps {
  posts: Array<{
    id: string;
    title: string;
    excerpt: string;
  }>;
}

export const getServerData = async (ctx: DataContext) => {
  const posts = await fetch('https://api.example.com/posts')
    .then(res => res.json());

  return {
    props: {
      posts
    }
  };
};

export default function BlogPage({ posts }: PageProps) {
  return (
    <div>
      {posts.map(post => (
        <article key={post.id}>
          <h2>{post.title}</h2>
          <p>{post.excerpt}</p>
        </article>
      ))}
    </div>
  );
}
```

### Using Dynamic Route Parameters

```typescript
import type { DataContext } from 'veryfront';

type Params = {
  slug: string;
};

interface PageProps {
  post: {
    title: string;
    content: string;
    author: string;
  };
}

export const getServerData = async (ctx: DataContext<Params>) => {
  const { slug } = ctx.params;

  const post = await fetch(`https://api.example.com/posts/${slug}`)
    .then(res => res.json());

  if (!post) {
    return { notFound: true };
  }

  return {
    props: {
      post
    }
  };
};

export default function BlogPost({ post }: PageProps) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>By {post.author}</p>
      <div>{post.content}</div>
    </article>
  );
}
```

### Using Query Parameters

```typescript
import type { DataContext } from 'veryfront';

interface PageProps {
  results: any[];
  query: string;
  page: number;
}

export const getServerData = async (ctx: DataContext) => {
  const query = ctx.query.get('q') || '';
  const page = parseInt(ctx.query.get('page') || '1', 10);

  const results = await fetch(
    `https://api.example.com/search?q=${query}&page=${page}`
  ).then(res => res.json());

  return {
    props: {
      results,
      query,
      page
    }
  };
};

export default function SearchPage({ results, query, page }: PageProps) {
  return (
    <div>
      <h1>Search Results for "{query}"</h1>
      <p>Page {page}</p>
      <ul>
        {results.map((result, i) => (
          <li key={i}>{result.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

### ISR with Revalidation

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const posts = await fetch('https://api.example.com/posts')
    .then(res => res.json());

  return {
    props: {
      posts,
      generatedAt: new Date().toISOString()
    },
    revalidate: 3600  // Revalidate every hour
  };
};

export default function BlogPage({ posts, generatedAt }) {
  return (
    <div>
      <p>Generated at: {generatedAt}</p>
      {posts.map(post => (
        <article key={post.id}>
          <h2>{post.title}</h2>
        </article>
      ))}
    </div>
  );
}
```

### JIT with Permanent Caching

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ id: string }>) => {
  const product = await fetch(
    `https://api.example.com/products/${ctx.params.id}`
  ).then(res => res.json());

  return {
    props: {
      product
    },
    cache: 'forever'  // Cache permanently until rebuild
  };
};

export default function ProductPage({ product }) {
  return (
    <div>
      <h1>{product.name}</h1>
      <p>${product.price}</p>
    </div>
  );
}
```

### Handling Not Found

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ slug: string }>) => {
  const post = await fetch(
    `https://api.example.com/posts/${ctx.params.slug}`
  ).then(res => {
    if (!res.ok) return null;
    return res.json();
  });

  if (!post) {
    return { notFound: true };
  }

  return {
    props: {
      post
    }
  };
};
```

### Redirecting Users

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // Check authentication
  const token = ctx.headers.get('cookie')?.includes('auth-token');

  if (!token) {
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }

  const user = await fetchUser(token);

  return {
    props: {
      user
    }
  };
};
```

### Permanent Redirect (301)

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext<{ oldSlug: string }>) => {
  const newUrl = await getNewUrl(ctx.params.oldSlug);

  return {
    redirect: {
      destination: newUrl,
      permanent: true  // 301 redirect
    }
  };
};
```

### Custom Headers

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();

  return {
    props: {
      data
    },
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=3600',
      'X-Custom-Header': 'custom-value',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  };
};
```

### Accessing Request Headers

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const userAgent = ctx.headers.get('user-agent') || '';
  const referer = ctx.headers.get('referer') || '';
  const cookie = ctx.headers.get('cookie') || '';

  const isMobile = /mobile/i.test(userAgent);

  const data = await fetchData({ isMobile });

  return {
    props: {
      data,
      isMobile
    }
  };
};
```

### Error Handling

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  try {
    const data = await fetch('https://api.example.com/data')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      });

    return {
      props: {
        data,
        error: null
      }
    };
  } catch (error) {
    console.error('Error fetching data:', error);

    return {
      props: {
        data: null,
        error: 'Failed to load data'
      }
    };
  }
};

export default function Page({ data, error }) {
  if (error) {
    return <div>Error: {error}</div>;
  }

  return <div>{data.title}</div>;
}
```

### Multiple Data Sources

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // Fetch multiple data sources in parallel
  const [posts, categories, featured] = await Promise.all([
    fetch('https://api.example.com/posts').then(r => r.json()),
    fetch('https://api.example.com/categories').then(r => r.json()),
    fetch('https://api.example.com/featured').then(r => r.json())
  ]);

  return {
    props: {
      posts,
      categories,
      featured
    }
  };
};
```

## Behavior

- **Server-only execution**: This function runs exclusively on the server, never in the browser
- **Build-time for SSG**: For static generation, runs at build time
- **Request-time for SSR**: For server-side rendering, runs on every request
- **Revalidation for ISR**: Runs on first request after revalidation period
- **Security**: Safe to use API keys and secrets (not exposed to client)

## Notes

- The function must be exported as `getServerData` (exact name)
- Cannot use browser-only APIs (like `window` or `document`)
- Database queries and file system access are safe to use
- Return value must be serializable (no functions, classes, etc.)
- For TypeScript, use `DataContext<YourParamsType>` for type-safe params

## Related

- [getStaticPaths](/reference/functions/get-static-paths.md) - Define static paths for SSG
- [notFound](/reference/functions/not-found.md) - Return 404 response
- [redirect](/reference/functions/redirect.md) - Redirect users
- [useParams](/reference/hooks/use-params.md) - Access params in client components
