---
title: "Routing System Overview"
category: "routing"
level: "beginner"
keywords: ["routing", "app-router", "pages-router", "file-based", "routes", "navigation"]
ai_summary: "Complete overview of Veryfront's file-based routing system supporting both App Router and Pages Router patterns"
related: ["routing/app-router", "routing/pages-router", "routing/dynamic-routes", "routing/api-routes"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Routing System Overview

Veryfront provides a flexible, file-based routing system that supports both modern App Router (Next.js 13+ style) and traditional Pages Router (Next.js 12 style) patterns. Choose the router that best fits your application's needs.

## Quick Comparison

| Feature | App Router | Pages Router |
|---------|-----------|--------------|
| **Directory** | `app/` | `pages/` |
| **Layouts** | Nested layouts with `layout.tsx` | `_app.tsx` only |
| **Loading States** | `loading.tsx` | Manual implementation |
| **Error Handling** | `error.tsx` | `_error.tsx` |
| **Route Groups** | `(group)` syntax | Not supported |
| **Parallel Routes** | `@folder` syntax | Not supported |
| **Simplicity** | More features, more complex | Simpler, straightforward |
| **Best For** | Large apps, complex layouts | Small-medium apps, simple structure |

## App Router (Recommended for New Projects)

The App Router is Veryfront's modern routing system inspired by Next.js 13+. It provides powerful features like nested layouts, loading states, and route groups.

### Basic Structure

```
app/
├── layout.tsx          # Root layout (wraps all pages)
├── page.tsx            # Home page (/)
├── loading.tsx         # Loading state for home
├── error.tsx           # Error boundary for home
├── about/
│   └── page.tsx        # About page (/about)
├── blog/
│   ├── layout.tsx      # Blog layout (wraps all blog pages)
│   ├── page.tsx        # Blog index (/blog)
│   └── [slug]/
│       └── page.tsx    # Blog post (/blog/my-post)
└── api/
    └── hello/
        └── route.ts    # API endpoint (/api/hello)
```

### Key Files

- **page.tsx** - Defines a route's UI
- **layout.tsx** - Shared UI for a segment and its children
- **loading.tsx** - Loading UI shown while page loads
- **error.tsx** - Error boundary for error handling
- **not-found.tsx** - 404 page for segment
- **route.ts** - API endpoints

### Example: Simple App Router Page

```typescript
// app/page.tsx
export default function HomePage() {
  return (
    <div>
      <h1>Welcome to Veryfront</h1>
      <p>Built with App Router</p>
    </div>
  );
}
```

### Example: Nested Layout

```typescript
// app/blog/layout.tsx
export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <nav>
        <a href="/blog">All Posts</a>
        <a href="/blog/about">About</a>
      </nav>
      <main>{children}</main>
    </div>
  );
}
```

Learn more: [App Router Guide](./app-router.md)

## Pages Router (Great for Simple Apps)

The Pages Router is Veryfront's traditional routing system, perfect for simpler applications or teams familiar with Next.js 12 patterns.

### Basic Structure

```
pages/
├── _app.tsx            # Custom App component
├── _document.tsx       # Custom Document (optional)
├── index.tsx           # Home page (/)
├── about.tsx           # About page (/about)
├── blog/
│   ├── index.tsx       # Blog index (/blog)
│   └── [slug].tsx      # Blog post (/blog/my-post)
└── api/
    └── hello.ts        # API endpoint (/api/hello)
```

### Key Files

- **index.tsx** - Index routes (e.g., `/` or `/blog`)
- **_app.tsx** - Root component (wraps all pages)
- **_document.tsx** - Custom HTML document structure
- **_error.tsx** - Custom error page

### Example: Simple Pages Router Page

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

### Example: Custom App Component

```typescript
// pages/_app.tsx
import type { AppProps } from 'next/app';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div>
      <header>My Site</header>
      <Component {...pageProps} />
      <footer>© 2025</footer>
    </div>
  );
}
```

Learn more: [Pages Router Guide](./pages-router.md)

## Dynamic Routes

Both routers support dynamic routes using square brackets in filenames.

### Single Dynamic Segment

```
# App Router
app/blog/[slug]/page.tsx     → /blog/hello-world

# Pages Router
pages/blog/[slug].tsx         → /blog/hello-world
```

### Catch-All Routes

```
# App Router
app/docs/[...slug]/page.tsx   → /docs/a/b/c

# Pages Router
pages/docs/[...slug].tsx      → /docs/a/b/c
```

### Optional Catch-All Routes

```
# App Router
app/shop/[[...slug]]/page.tsx → /shop, /shop/a, /shop/a/b

# Pages Router
pages/shop/[[...slug]].tsx    → /shop, /shop/a, /shop/a/b
```

Learn more: [Dynamic Routes Guide](./dynamic-routes.md)

## API Routes

Both routers support API endpoints for building server-side APIs.

### App Router API Routes

```typescript
// app/api/hello/route.ts
export async function GET(request: Request) {
  return Response.json({ message: 'Hello from App Router API' });
}

export async function POST(request: Request) {
  const body = await request.json();
  return Response.json({ received: body });
}
```

### Pages Router API Routes

```typescript
// pages/api/hello.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    res.status(200).json({ message: 'Hello from Pages Router API' });
  } else if (req.method === 'POST') {
    res.status(200).json({ received: req.body });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
```

Learn more: [API Routes Guide](./api-routes.md)

## Navigation

### Using the Link Component

```typescript
import { Link } from 'veryfront';

export default function Navigation() {
  return (
    <nav>
      <Link href="/">Home</Link>
      <Link href="/about">About</Link>
      <Link href="/blog">Blog</Link>
    </nav>
  );
}
```

### Programmatic Navigation

```typescript
'use client'; // App Router requires this for client-side hooks

import { useRouter } from 'veryfront';

export default function LoginButton() {
  const router = useRouter();

  const handleLogin = async () => {
    await loginUser();
    router.push('/dashboard');
  };

  return <button onClick={handleLogin}>Login</button>;
}
```

## Route Priority

When multiple routes could match a URL, Veryfront uses this priority order:

1. **Static routes** (exact match)
2. **Dynamic routes** with parameters
3. **Catch-all routes**

Example:
```
/blog/about          → Matches blog/about/page.tsx (static)
/blog/hello-world    → Matches blog/[slug]/page.tsx (dynamic)
/reference/routes     → Matches docs/[...slug]/page.tsx (catch-all)
```

## Choosing Your Router

### Use App Router If:
- ✅ Building a new application from scratch
- ✅ Need nested layouts or loading states
- ✅ Building a large, complex application
- ✅ Want the latest React features (Server Components, Suspense)
- ✅ Need route groups or parallel routes

### Use Pages Router If:
- ✅ Building a simple, straightforward application
- ✅ Team is familiar with Next.js 12 patterns
- ✅ Migrating from an older Next.js app
- ✅ Don't need complex layout nesting
- ✅ Prefer simpler, more predictable routing

### Can I Mix Both?
No. Choose one router per project. Veryfront detects which router you're using based on whether you have an `app/` or `pages/` directory.

## Common Patterns

### Blog with Categories

**App Router:**
```
app/blog/
├── page.tsx                    # /blog
├── [category]/
│   ├── page.tsx                # /blog/tutorials
│   └── [slug]/
│       └── page.tsx            # /blog/tutorials/my-post
```

**Pages Router:**
```
pages/blog/
├── index.tsx                   # /blog
├── [category]/
│   ├── index.tsx               # /blog/tutorials
│   └── [slug].tsx              # /blog/tutorials/my-post
```

### Dashboard with Auth

**App Router:**
```
app/(dashboard)/
├── layout.tsx                  # Shared dashboard layout
├── dashboard/
│   └── page.tsx                # /dashboard
├── settings/
│   └── page.tsx                # /settings
└── profile/
    └── page.tsx                # /profile
```

**Pages Router:**
```
pages/
├── _app.tsx                    # Check auth here
├── dashboard.tsx               # /dashboard
├── settings.tsx                # /settings
└── profile.tsx                 # /profile
```

## Data Fetching

Both routers support server-side data fetching with `getServerData`:

```typescript
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData();
  return { props: { data } };
};

const Page: PageWithData<{ data: MyData }> = ({ data }) => {
  return <div>{data.title}</div>;
};

export default Page;
```

Learn more about data fetching in the [Data Fetching Guide](/reference/functions/get-server-data.md)

## TypeScript Support

Both routers have full TypeScript support with automatic type inference:

```typescript
import type { PageWithData, DataContext } from 'veryfront';

interface Post {
  id: string;
  title: string;
  content: string;
}

export const getServerData = async (ctx: DataContext) => {
  const post: Post = await fetchPost(ctx.params.slug as string);
  return { props: { post } };
};

// TypeScript automatically infers the prop type
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

## Performance Considerations

- **App Router**: Slightly more overhead due to nested layouts, but more efficient code splitting
- **Pages Router**: Simpler, less overhead, but less flexible code splitting
- **Both**: Support all rendering modes (SSR, SSG, ISR, JIT)

## Migration Between Routers

Switching from Pages Router to App Router (or vice versa) requires restructuring your files, but most of your component code can remain unchanged.

### Pages → App Router

1. Create `app/` directory
2. Move `pages/index.tsx` → `app/page.tsx`
3. Convert `pages/_app.tsx` → `app/layout.tsx`
4. Convert `pages/about.tsx` → `app/about/page.tsx`
5. Update API routes: `pages/api/hello.ts` → `app/api/hello/route.ts`

### App → Pages Router

1. Create `pages/` directory
2. Move `app/page.tsx` → `pages/index.tsx`
3. Convert `app/layout.tsx` → `pages/_app.tsx`
4. Convert `app/about/page.tsx` → `pages/about.tsx`
5. Update API routes: `app/api/hello/route.ts` → `pages/api/hello.ts`

## Examples

See working examples:
- [Minimal App Router](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-app-router) - Simplest App Router setup
- [Minimal Pages](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-pages) - Simplest Pages Router setup
- [Blog Example](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - Full blog with dynamic routes
- [Auth App](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app) - Authentication with protected routes

## Prerequisites

Before diving into routing, make sure you have:
- [Veryfront installed](/learn/installation.md) - Set up your development environment
- [Basic React knowledge](https://react.dev/learn) - Understand React fundamentals
- [Quick Start completed](/learn/quickstart.md) - Built your first Veryfront app

## Next Steps

### Learn the Routers
- [App Router Guide](./app-router.md) - Modern routing with nested layouts and loading states
- [Pages Router Guide](./pages-router.md) - Simple, straightforward routing
- [Dynamic Routes Guide](./dynamic-routes.md) - URL parameters and catch-all routes
- [API Routes Guide](./api-routes.md) - Build RESTful APIs and webhooks

### Related Guides

#### Rendering
- [Rendering Modes](/guides/rendering/README.md) - Understand SSR, SSG, ISR, JIT, and RSC
- [SSR Guide](/guides/rendering/ssr.md) - Server-side rendering for dynamic routes
- [SSG Guide](/guides/rendering/ssg.md) - Pre-render static routes at build time

#### Components & Hooks
- [Link Component](/reference/components/link.md) - Client-side navigation between routes
- [useRouter Hook](/reference/hooks/use-router.md) - Programmatic navigation
- [useParams Hook](/reference/hooks/use-params.md) - Access dynamic route parameters
- [usePathname Hook](/reference/hooks/use-pathname.md) - Get current route pathname

#### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Configure routing behavior
- [File Conventions](/reference/file-conventions/README.md) - Special files in App Router

## Reference

### API Reference
- [Functions](/reference/functions/README.md) - Server-side functions
  - [getServerData](/reference/functions/get-server-data.md) - Fetch data for routes
  - [getStaticPaths](/reference/functions/get-static-paths.md) - Define static paths
  - [redirect](/reference/functions/redirect.md) - Redirect users
  - [notFound](/reference/functions/not-found.md) - Show 404 pages

### Deployment
- [Deployment Overview](/guides/deployment/README.md) - Deploy your routed application
- [Deno Deployment](/guides/deployment/deno.md) - Deploy to Deno Deploy
- [Node.js Deployment](/guides/deployment/node.md) - Deploy with Node.js

## Troubleshooting

Having issues? Check these guides:
- [Debugging Guide](/guides/troubleshooting/debugging.md) - Debug routing problems
- [Troubleshooting](/guides/troubleshooting/README.md) - Common routing issues
