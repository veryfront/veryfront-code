---
title: "Pages Router Guide"
category: "routing"
level: "beginner"
keywords: ["pages-router", "routing", "pages", "next12", "traditional"]
ai_summary: "Complete guide to Veryfront's Pages Router with file-based routing, data fetching, and traditional page-based architecture"
related: ["routing/app-router", "routing/dynamic-routes", "routing/api-routes"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Pages Router Guide

The Pages Router is Veryfront's traditional routing system inspired by Next.js 12 and earlier. It provides a simple, file-based routing approach that's perfect for smaller applications and developers familiar with classic Next.js patterns.

## Why Pages Router?

- **Simple & Intuitive** - One file = one route
- **Zero Configuration** - Just create files in `pages/`
- **Easy to Learn** - Perfect for beginners
- **Proven Pattern** - Battle-tested architecture
- **Fast Setup** - Get started in minutes

**Best for:** Small to medium projects, simple sites, learning Veryfront, quick prototypes

## Getting Started

### Basic Structure

```
pages/
├── index.tsx           # Home page (/)
├── about.tsx           # /about
├── blog.tsx            # /blog
├── contact.tsx         # /contact
├── _app.tsx            # Custom App (optional)
└── _document.tsx       # Custom Document (optional)
```

### Your First Page

```typescript
// pages/index.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Welcome to Veryfront</h1>
      <p>Built with Pages Router</p>
    </div>
  );
}
```

Visit **http://localhost:3000/** 🎉

---

## File-Based Routing

Every file in `pages/` automatically becomes a route.

### Basic Routes

```
pages/
├── index.tsx           # /
├── about.tsx           # /about
├── contact.tsx         # /contact
└── pricing.tsx         # /pricing
```

### Nested Routes

```
pages/
├── blog/
│   ├── index.tsx       # /blog
│   ├── first-post.tsx  # /blog/first-post
│   └── second-post.tsx # /blog/second-post
└── products/
    ├── index.tsx       # /products
    └── features.tsx    # /products/features
```

### Index Routes

`index.tsx` files map to the root of their directory:

```
pages/
├── index.tsx           # /
├── blog/
│   └── index.tsx       # /blog
└── docs/
    └── index.tsx       # /docs
```

---

## Dynamic Routes

Use `[param]` syntax for dynamic segments.

### Single Dynamic Segment

```typescript
// pages/blog/[slug].tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  return { props: { post } };
};

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <article>
      <h1>{post.title}</h1>
      <p>{post.content}</p>
    </article>
  );
};

export default BlogPost;
```

**URLs:**
- `/blog/hello-world` → `slug = "hello-world"`
- `/blog/my-first-post` → `slug = "my-first-post"`

### Catch-All Routes

```typescript
// pages/docs/[...slug].tsx
export const getServerData = async (ctx: DataContext) => {
  const { slug } = ctx.params; // slug is an array
  const path = slug.join('/');
  const doc = await fetchDoc(path);
  return { props: { doc } };
};
```

**URLs:**
- `/docs/getting-started` → `slug = ["getting-started"]`
- `/reference/routes` → `slug = ["api", "routes"]`
- `/docs/guide/advanced/patterns` → `slug = ["guide", "advanced", "patterns"]`

### Optional Catch-All Routes

```typescript
// pages/blog/[[...slug]].tsx
export const getServerData = async (ctx: DataContext) => {
  const slug = ctx.params.slug || [];

  if (slug.length === 0) {
    // /blog - list all posts
    const posts = await fetchAllPosts();
    return { props: { posts, type: 'list' } };
  }

  // /blog/category/tutorials - filter by category
  const posts = await fetchPostsByPath(slug);
  return { props: { posts, type: 'filter' } };
};
```

**URLs:**
- `/blog` → `slug = undefined` (also matched!)
- `/blog/tutorials` → `slug = ["tutorials"]`
- `/blog/2024/january` → `slug = ["2024", "january"]`

---

## Data Fetching

### Server-Side Rendering (SSR)

Fetch data on every request using `getServerData`:

```typescript
// pages/dashboard.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);
  const stats = await fetchUserStats(user.id);

  return {
    props: { user, stats }
  };
};

const Dashboard: PageWithData<{ user: User; stats: Stats }> = ({
  user,
  stats
}) => {
  return (
    <div>
      <h1>Welcome, {user.name}</h1>
      <div>Posts: {stats.posts}</div>
      <div>Views: {stats.views}</div>
    </div>
  );
};

export default Dashboard;
```

### Static Site Generation (SSG)

Generate static pages at build time:

```typescript
// pages/blog/[slug].tsx
import type { PageWithData, DataContext } from 'veryfront';

// 1. Define which paths to pre-render
export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false, // 404 for other slugs
  };
};

// 2. Fetch data for each path
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
      <div>{post.content}</div>
    </article>
  );
};

export default BlogPost;
```

### Incremental Static Regeneration (ISR)

Regenerate static pages periodically:

```typescript
// pages/products/[id].tsx
export const getServerData = async (ctx: DataContext) => {
  const product = await fetchProduct(ctx.params.id);

  return {
    props: { product },
    revalidate: 60, // Regenerate every 60 seconds
  };
};
```

### Just-In-Time (JIT) Rendering

**Veryfront-specific:** Cache forever until manually invalidated:

```typescript
// pages/blog/[slug].tsx
export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);

  return {
    props: { post },
    cache: 'forever', // JIT mode - cache until invalidated
  };
};
```

Invalidate cache:
```typescript
// pages/api/revalidate.ts
import { invalidateCache } from 'veryfront';

export default async function handler(req) {
  await invalidateCache('/blog/my-post');
  return new Response('Revalidated');
}
```

---

## Custom App

Customize the page initialization with `_app.tsx`:

```typescript
// pages/_app.tsx
import type { AppProps } from 'veryfront';
import '../styles/global.css';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <header>
        <nav>My App Navigation</nav>
      </header>
      <Component {...pageProps} />
      <footer>© 2025</footer>
    </>
  );
}
```

**Use _app.tsx for:**
- Global layouts
- Global CSS imports
- Persistent state
- Error boundaries
- Analytics integration

### With Layout

```typescript
// pages/_app.tsx
import type { AppProps } from 'veryfront';
import { useRouter } from 'veryfront';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isDashboard = router.pathname.startsWith('/dashboard');

  return (
    <div className="app">
      {isDashboard ? (
        <DashboardLayout>
          <Component {...pageProps} />
        </DashboardLayout>
      ) : (
        <MainLayout>
          <Component {...pageProps} />
        </MainLayout>
      )}
    </div>
  );
}
```

---

## Custom Document

Customize the HTML document structure with `_document.tsx`:

```typescript
// pages/_document.tsx
import { Html, Head, Main, NextScript } from 'veryfront/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="UTF-8" />
        <link rel="icon" href="/favicon.ico" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

**Use _document.tsx for:**
- Custom HTML attributes
- External fonts
- Analytics scripts (in <Head>)
- Custom server-side rendering logic

**⚠️ Important:** Only use _document.tsx for static markup. Don't use React hooks or event handlers here.

---

## Navigation

### Link Component

```typescript
import { Link } from 'veryfront';

export default function Navigation() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/blog">Blog</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  );
}
```

### Active Links

```typescript
import { Link, useRouter } from 'veryfront';

export default function NavLink({ href, children }) {
  const router = useRouter();
  const isActive = router.pathname === href;

  return (
    <Link
      href={href}
      className={isActive ? 'active' : ''}
    >
      {children}
    </Link>
  );
}
```

### Programmatic Navigation

```typescript
'use client';

import { useRouter } from 'veryfront';

export default function LoginButton() {
  const router = useRouter();

  const handleLogin = async () => {
    const success = await loginUser();
    if (success) {
      router.push('/dashboard');
    }
  };

  return <button onClick={handleLogin}>Login</button>;
}
```

### Navigation Methods

```typescript
import { useRouter } from 'veryfront';

function MyComponent() {
  const router = useRouter();

  // Navigate to a new page
  router.push('/about');

  // Replace current page (no history entry)
  router.replace('/login');

  // Go back
  router.back();

  // Navigate with query params
  router.push('/search?q=hello');

  // Navigate with dynamic route
  router.push(`/blog/${postSlug}`);
}
```

---

## Metadata

### Static Metadata

```typescript
// pages/about.tsx
import { Head } from 'veryfront';

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About Us - My App</title>
        <meta name="description" content="Learn more about our company" />
        <meta property="og:title" content="About Us" />
      </Head>
      <div>
        <h1>About Us</h1>
        <p>We are awesome!</p>
      </div>
    </>
  );
}
```

### Dynamic Metadata

```typescript
// pages/blog/[slug].tsx
import { Head } from 'veryfront';
import type { PageWithData } from 'veryfront';

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <>
      <Head>
        <title>{post.title} - My Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.excerpt} />
        <meta property="og:image" content={post.image} />
      </Head>
      <article>
        <h1>{post.title}</h1>
        <div>{post.content}</div>
      </article>
    </>
  );
};

export default BlogPost;
```

---

## Error Pages

### 404 Page

```typescript
// pages/404.tsx
import { Link } from 'veryfront';

export default function NotFound() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link href="/">Go Home</Link>
    </div>
  );
}
```

### 500 Page

```typescript
// pages/500.tsx
export default function ServerError() {
  return (
    <div>
      <h1>500 - Server Error</h1>
      <p>Something went wrong on our end.</p>
    </div>
  );
}
```

### Custom Error Page

```typescript
// pages/_error.tsx
import type { ErrorProps } from 'veryfront';

export default function Error({ statusCode }: ErrorProps) {
  return (
    <div>
      <h1>
        {statusCode
          ? `An error ${statusCode} occurred on server`
          : 'An error occurred on client'}
      </h1>
    </div>
  );
}
```

---

## API Routes

Create backend endpoints in the `pages/api/` directory:

```typescript
// pages/api/hello.ts
export default function handler(req: Request) {
  return new Response(
    JSON.stringify({ message: 'Hello from API!' }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
```

**URL:** `/api/hello`

See [API Routes Guide](./api-routes.md) for more details.

---

## Client-Side Features

### Client Components

By default, pages are Server Components. Use `'use client'` for interactivity:

```typescript
// pages/counter.tsx
'use client';

import { useState } from 'react';

export default function CounterPage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <h1>Counter</h1>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
```

### Access Router Information

```typescript
'use client';

import { useRouter, usePathname, useParams, useSearchParams } from 'veryfront';

export default function InfoPage() {
  const router = useRouter();
  const pathname = usePathname();    // Current path
  const params = useParams();        // Route params
  const searchParams = useSearchParams(); // Query params

  return (
    <div>
      <p>Pathname: {pathname}</p>
      <p>Query: {searchParams.get('q')}</p>
    </div>
  );
}
```

---

## TypeScript Support

### Page Component Types

```typescript
import type { PageWithData, DataContext } from 'veryfront';

interface PageProps {
  post: Post;
  user: User;
}

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  const user = await getCurrentUser(ctx.request);

  return {
    props: { post, user }
  };
};

const Page: PageWithData<PageProps> = ({ post, user }) => {
  return <div>{post.title}</div>;
};

export default Page;
```

### DataContext Type

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  // ctx.params - Route parameters
  // ctx.query - Query string
  // ctx.request - Request object
  // ctx.headers - Request headers
  // ctx.cookies - Cookies

  const { slug } = ctx.params;
  const { search } = ctx.query;

  return { props: { slug, search } };
};
```

---

## Best Practices

### 1. Use Layouts Wisely

```typescript
// pages/_app.tsx
export default function App({ Component, pageProps }: AppProps) {
  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}
```

### 2. Handle Loading States

```typescript
'use client';

import { useRouter } from 'veryfront';
import { useEffect, useState } from 'react';

export default function Page() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleStart = () => setLoading(true);
    const handleComplete = () => setLoading(false);

    router.events.on('routeChangeStart', handleStart);
    router.events.on('routeChangeComplete', handleComplete);

    return () => {
      router.events.off('routeChangeStart', handleStart);
      router.events.off('routeChangeComplete', handleComplete);
    };
  }, [router]);

  return loading ? <Spinner /> : <Content />;
}
```

### 3. Optimize Images

```typescript
import { OptimizedImage } from 'veryfront';

export default function Page() {
  return (
    <OptimizedImage
      src="/hero.jpg"
      alt="Hero image"
      width={800}
      height={600}
      priority
    />
  );
}
```

### 4. Use Environment Variables

```typescript
// pages/api/data.ts
export default async function handler(req: Request) {
  const apiKey = Deno.env.get('API_KEY');
  const data = await fetchData(apiKey);

  return new Response(JSON.stringify(data));
}
```

---

## Common Patterns

### Protected Routes

```typescript
// pages/dashboard.tsx
import type { PageWithData, DataContext } from 'veryfront';
import { redirect } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const user = await getCurrentUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  return { props: { user } };
};
```

### Pagination

```typescript
// pages/blog.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const page = parseInt(ctx.query.page || '1');
  const limit = 10;

  const posts = await fetchPosts({ page, limit });
  const total = await countPosts();

  return {
    props: {
      posts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  };
};
```

### Search

```typescript
// pages/search.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const query = ctx.query.q || '';
  const results = query ? await searchPosts(query) : [];

  return {
    props: { query, results }
  };
};
```

---

## Migration from App Router

| App Router | Pages Router |
|------------|--------------|
| `app/page.tsx` | `pages/index.tsx` |
| `app/about/page.tsx` | `pages/about.tsx` |
| `app/layout.tsx` | `pages/_app.tsx` |
| `app/error.tsx` | `pages/_error.tsx` |
| `app/not-found.tsx` | `pages/404.tsx` |
| `app/loading.tsx` | Custom component in _app.tsx |

### Moving to Pages Router

1. **Move pages:**
   ```bash
   app/about/page.tsx → pages/about.tsx
   app/blog/[slug]/page.tsx → pages/blog/[slug].tsx
   ```

2. **Convert layouts to _app.tsx:**
   ```typescript
   // pages/_app.tsx
   export default function App({ Component, pageProps }) {
     return (
       <Layout>
         <Component {...pageProps} />
       </Layout>
     );
   }
   ```

3. **Update data fetching:** Keep using `getServerData` (same API!)

4. **Remove special files:** No more `loading.tsx`, `error.tsx` - handle in _app.tsx

---

## Performance Tips

### 1. Use SSG for Static Content

```typescript
export const getStaticPaths = async () => {
  return {
    paths: await generatePaths(),
    fallback: false
  };
};
```

### 2. Implement ISR for Semi-Dynamic Content

```typescript
export const getServerData = async (ctx) => {
  return {
    props: await fetchData(),
    revalidate: 60 // Regenerate every 60 seconds
  };
};
```

### 3. Code Split Large Components

```typescript
import dynamic from 'veryfront/dynamic';

const HeavyComponent = dynamic(() => import('../components/Heavy'), {
  loading: () => <Spinner />,
  ssr: false // Don't render on server
});
```

---

## Related Documentation

- [App Router Guide](./app-router.md) - Modern routing with layouts
- [Dynamic Routes](./dynamic-routes.md) - URL parameters in depth
- [API Routes](./api-routes.md) - Backend endpoints
- [Data Fetching](/reference/functions/data-fetching.md) - Complete API reference

---

## Examples

- [Minimal Pages](/examples/minimal-pages/) - Simple Pages Router setup
- [Data Fetching Demo](/examples/data-fetching-demo/) - All patterns
- [Blog Example](/examples/blog/) - Complete blog
- [Auth App](/examples/auth-app/) - Protected routes

---

## Quick Reference

### File Structure
```
pages/
├── index.tsx          # /
├── about.tsx          # /about
├── blog/
│   ├── index.tsx      # /blog
│   └── [slug].tsx     # /blog/:slug
├── _app.tsx           # Custom App
├── _document.tsx      # Custom Document
├── _error.tsx         # Custom Error
├── 404.tsx            # 404 page
└── api/
    └── hello.ts       # /api/hello
```

### Data Fetching Methods
- **SSR:** `getServerData` (runs on every request)
- **SSG:** `getStaticPaths` + `getServerData` (runs at build time)
- **ISR:** `getServerData` + `revalidate` (periodic regeneration)
- **JIT:** `getServerData` + `cache: 'forever'` (Veryfront-specific)

### Navigation
- `<Link href="/about">` - Client-side navigation
- `router.push('/path')` - Programmatic navigation
- `router.replace('/path')` - Replace history
- `router.back()` - Go back

### Hooks
- `useRouter()` - Access router
- `usePathname()` - Current path
- `useParams()` - Route parameters
- `useSearchParams()` - Query parameters
