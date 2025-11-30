# Veryfront - Data Fetching Demo

This example demonstrates various data fetching patterns in Veryfront:

- Server-side data fetching with `getServerData`
- Static generation with `getStaticPaths`
- Client-side data fetching
- Data caching strategies
- Loading and error states

## Setup

1. Install dependencies:

```bash
npm install
# or
deno install
```

2. Run the dev server:

```bash
npm run dev
# or
deno task dev
```

3. Visit http://localhost:3002

## What It Does

1. **SSR with getServerData**: Fetch data on each request
2. **SSG with getStaticPaths**: Pre-render pages at build time
3. **Client-side fetching**: Fetch data in the browser
4. **Caching**: Automatic caching of server data
5. **Error handling**: Graceful error states

## Files

- `pages/index.tsx` - Server-side data fetching example
- `pages/static.tsx` - Static generation example

## Data Fetching Patterns

### Server-Side Rendering (SSR)
```typescript
export async function getServerData() {
  const data = await fetch('https://api.example.com/data').then(r => r.json());

  return {
    props: { data },
  };
}

export default function Page({ data }) {
  return <div>{data.title}</div>;
}
```

### Static Site Generation (SSG)
```typescript
export async function getStaticPaths() {
  const posts = await fetch('https://api.example.com/posts').then(r => r.json());

  return posts.map(post => ({
    params: { slug: post.slug },
    props: { post },
  }));
}

export default function Post({ post }) {
  return <div>{post.title}</div>;
}
```

### Client-Side Fetching
```typescript
import { useState, useEffect } from 'react';

export default function Page() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/data')
      .then(r => r.json())
      .then(setData);
  }, []);

  if (!data) return <div>Loading...</div>;
  return <div>{data.title}</div>;
}
```

## Caching Strategies

```typescript
// veryfront.config.ts
export default {
  cache: {
    render: {
      type: 'kv',
      ttl: 3600000, // 1 hour
    },
  },
};
```

## Use Cases

- **Dynamic Content**: Use SSR for frequently changing data
- **Static Content**: Use SSG for mostly static content
- **User-Specific**: Use client-side for user-specific data
- **Hybrid**: Mix strategies for optimal performance

## Performance Tips

- Use SSG for content that doesn't change often
- Use ISR (Incremental Static Regeneration) for balanced approach
- Cache API responses appropriately
- Use loading states for better UX
