# Data Module

The Data module provides data fetching utilities for server-side and static data loading, similar to Next.js's `getServerSideProps` and `getStaticPaths` APIs.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { DataFetcher, notFound, redirect } from "#data";

// Using barrel file
import { DataFetcher, notFound, redirect } from "./data/index.ts";
```

## Public API Overview

The Data module exports:

- **`DataFetcher`** - Main class for data fetching with caching support
- **`notFound()`** - Helper to return 404 responses
- **`redirect()`** - Helper to return redirect responses
- **Types** - `DataContext`, `DataResult`, `PageWithData`, `StaticPathsResult`, `InferGetServerDataProps`, `CacheEntry`

## File Structure

```
data/
├── index.ts                    # Public API (barrel file) ← USE THIS
├── README.md                   # This file
├── fetching.ts                 # Re-exports from fetching/ subdirectory
└── fetching/                   # Data fetching implementation
    ├── index.ts               # Fetching barrel file
    ├── data-fetcher.ts        # Main DataFetcher class
    ├── data-fetching-cache.ts # Cache management
    ├── helpers.ts             # Utility helpers (notFound, redirect)
    ├── server-data-fetcher.ts # Server-side data fetching
    ├── static-data-fetcher.ts # Static data fetching
    ├── static-paths-fetcher.ts # Static path generation
    └── types.ts               # Type definitions
```

## Quick Start

### Server-Side Data Fetching

Fetch data on each request (SSR):

```typescript
import type { DataContext, DataResult } from "#data";

interface Post {
  id: string;
  title: string;
  content: string;
}

interface Props {
  post: Post;
}

export async function getServerData(
  context: DataContext,
): Promise<DataResult<Props>> {
  const { params } = context;

  // Fetch data from API
  const response = await fetch(`https://api.example.com/posts/${params.id}`);

  if (!response.ok) {
    return notFound();
  }

  const post = await response.json();

  return {
    props: { post },
  };
}

export default function PostPage({ post }: Props) {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
}
```

### Static Site Generation

Pre-render pages at build time:

```typescript
import type { DataContext, DataResult, StaticPathsResult } from "#data";

// Generate static paths at build time
export async function getStaticPaths(): Promise<StaticPathsResult> {
  const response = await fetch("https://api.example.com/posts");
  const posts = await response.json();

  const paths = posts.map((post: { id: string }) => ({
    params: { id: post.id },
  }));

  return {
    paths,
    fallback: false, // or 'blocking' or true
  };
}

// Fetch data for each path at build time
export async function getStaticProps(
  context: DataContext,
): Promise<DataResult<Props>> {
  const { params } = context;

  const response = await fetch(`https://api.example.com/posts/${params.id}`);
  const post = await response.json();

  return {
    props: { post },
    revalidate: 60, // Revalidate every 60 seconds (ISR)
  };
}
```

### Using DataFetcher Programmatically

```typescript
import { DataFetcher } from "#data";
import { getAdapter } from "../adapters/index.ts";

const adapter = await getAdapter();
const fetcher = new DataFetcher({
  projectDir: "./my-app",
  adapter,
});

// Fetch server data
const result = await fetcher.fetchServerData({
  slug: "about",
  params: {},
  query: new URLSearchParams(),
  req: request,
});

// Fetch static data
const staticResult = await fetcher.fetchStaticData({
  slug: "blog/post-1",
  params: { id: "post-1" },
});

// Generate static paths
const paths = await fetcher.fetchStaticPaths("blog/[id]");
```

## Key Concepts

### 1. Data Context

Every data fetching function receives a context object:

```typescript
interface DataContext {
  params: Record<string, string>; // Route parameters
  query: URLSearchParams; // Query parameters
  req?: Request; // Original request (SSR only)
  slug: string; // Page slug
}
```

### 2. Data Result

Data fetching functions return a result object:

```typescript
interface DataResult<T = any> {
  props?: T; // Props to pass to component
  redirect?: { // Redirect response
    destination: string;
    permanent?: boolean;
  };
  notFound?: boolean; // Return 404
  revalidate?: number; // ISR revalidation (seconds)
}
```

### 3. Response Helpers

Convenience functions for common responses:

```typescript
import { notFound, redirect } from "#data";

// Return 404
export async function getServerData(context: DataContext) {
  const data = await fetchData(context.params.id);
  if (!data) {
    return notFound();
  }
  return { props: { data } };
}

// Redirect
export async function getServerData(context: DataContext) {
  if (!isAuthenticated(context.req)) {
    return redirect("/login", { permanent: false });
  }
  return { props: { user } };
}
```

### 4. Caching

DataFetcher includes built-in caching:

```typescript
const fetcher = new DataFetcher({
  projectDir: "./app",
  adapter,
  cache: {
    enabled: true,
    ttl: 300, // 5 minutes
    maxSize: 100,
  },
});
```

## Advanced Usage

### Incremental Static Regeneration (ISR)

Revalidate static pages on demand:

```typescript
export async function getStaticProps(context: DataContext) {
  const data = await fetchData();

  return {
    props: { data },
    revalidate: 60, // Revalidate every 60 seconds
  };
}
```

### Fallback Modes

Control how missing pages are handled:

```typescript
export async function getStaticPaths() {
  return {
    paths: [{ params: { id: "1" } }],
    fallback: "blocking", // Options: false, true, 'blocking'
  };
}
```

- `false`: Return 404 for non-pre-rendered paths
- `true`: Show fallback, then fetch data client-side
- `'blocking'`: Wait for data before showing page

### Type Inference

Infer prop types from data fetching functions:

```typescript
import type { InferGetServerDataProps } from "#data";

export async function getServerData(context: DataContext) {
  return { props: { message: "Hello", count: 42 } };
}

// Automatically infer { message: string; count: number }
type Props = InferGetServerDataProps<typeof getServerData>;

export default function Page({ message, count }: Props) {
  return <div>{message}: {count}</div>;
}
```

### Error Handling

Handle errors gracefully:

```typescript
export async function getServerData(context: DataContext) {
  try {
    const data = await fetchData(context.params.id);
    return { props: { data } };
  } catch (error) {
    console.error("Failed to fetch data:", error);
    return notFound();
  }
}
```

## Testing

Tests are located in `tests/integration/data/`:

```bash
deno test tests/integration/data/
```

## Performance Tips

1. **Use Static Generation** - Pre-render pages when possible
2. **Enable Caching** - Cache data fetching results
3. **Use ISR** - Revalidate static pages on demand
4. **Minimize Data** - Only fetch what you need
5. **Parallel Fetching** - Use `Promise.all()` for multiple requests

## Module Boundaries

The `data/` module has established boundaries to ensure clean architecture and maintainability.

### Public API (via Barrel File)

**Always import from the barrel file** (`index.ts`):

```typescript
// CORRECT - Using import map alias
import { DataFetcher, notFound, redirect } from "#data";

// ALSO CORRECT - Using barrel file directly
import { DataFetcher, notFound, redirect } from "./data/index.ts";

// WRONG - Deep import bypassing barrel file
import { DataFetcher } from "./data/data-fetcher.ts";
```

### Internal Files (Do Not Import Directly)

These are implementation details and should not be imported from outside the module:

- `fetching/data-fetcher.ts` - Internal DataFetcher implementation
- `fetching/data-fetching-cache.ts` - Internal cache management
- `fetching/helpers.ts` - Internal helper implementations
- `fetching/server-data-fetcher.ts` - Internal server data fetching
- `fetching/static-data-fetcher.ts` - Internal static data fetching
- `fetching/static-paths-fetcher.ts` - Internal static path generation
- `fetching/types.ts` - Internal type definitions

### Enforcing Boundaries

Run the deep import linter to check for violations:

```bash
deno task lint:ban-deep-imports
```

This will detect any imports that bypass the barrel file and suggest corrections.

### Why Module Boundaries Matter

1. **Encapsulation**: Internal implementation can be refactored without breaking external code
2. **Clear API**: Public API is explicitly defined in one place
3. **Maintainability**: Changes to internal files don't affect consumers
4. **Discoverability**: Developers know exactly what's public by reading `index.ts`
5. **Type Safety**: Export types are properly managed and versioned

## Related Domains

- **server/**: Server implementations that use data fetching
- **rendering/**: Rendering system that integrates with data fetching
- **build/**: Build system that generates static pages

## Migration from Next.js

Veryfront's data fetching API is compatible with Next.js:

| Next.js              | Veryfront               |
| -------------------- | ----------------------- |
| `getServerSideProps` | `getServerData`         |
| `getStaticProps`     | `getStaticProps` (same) |
| `getStaticPaths`     | `getStaticPaths` (same) |
| `notFound()`         | `notFound()` (same)     |
| `redirect()`         | `redirect()` (same)     |

Simply rename `getServerSideProps` to `getServerData` and use Veryfront's import aliases.
