---
title: "App Router Guide"
category: "routing"
level: "intermediate"
keywords: ["app-router", "routing", "layouts", "loading", "error", "next13"]
ai_summary: "Complete guide to Veryfront's App Router with nested layouts, loading states, error boundaries, and route groups"
related: ["routing/pages-router", "routing/dynamic-routes", "routing/api-routes"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# App Router Guide

The App Router is Veryfront's modern routing system inspired by Next.js 13+. It provides powerful features like nested layouts, loading states, error boundaries, and parallel routes.

## Why App Router?

- **Nested Layouts** - Share UI between routes without re-rendering
- **Loading States** - Built-in loading UI with Suspense
- **Error Boundaries** - Granular error handling per route
- **Route Groups** - Organize routes without affecting URL structure
- **Parallel Routes** - Render multiple pages in the same layout
- **Intercepting Routes** - Intercept navigation for modals/overlays

**Best for:** Large applications, complex layouts, modern React features

## Getting Started

### Basic Structure

```
app/
├── layout.tsx          # Root layout (required)
├── page.tsx            # Home page (/)
├── loading.tsx         # Loading UI for home
├── error.tsx           # Error boundary
├── not-found.tsx       # 404 page
├── about/
│   └── page.tsx        # /about
└── blog/
    ├── layout.tsx      # Blog layout
    ├── page.tsx        # /blog
    └── [slug]/
        └── page.tsx    # /blog/my-post
```

### Your First Page

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

Visit **http://localhost:3000/** 🎉

---

## Layouts

Layouts wrap pages and persist across navigation. They don't re-render when navigating between child pages.

### Root Layout (Required)

```typescript
// app/layout.tsx
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header>
          <nav>My App</nav>
        </header>
        <main>{children}</main>
        <footer>© 2025</footer>
      </body>
    </html>
  );
}
```

### Nested Layouts

```typescript
// app/blog/layout.tsx
export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="blog-container">
      <aside>
        <h3>Categories</h3>
        <ul>
          <li>Tutorials</li>
          <li>News</li>
        </ul>
      </aside>
      <article>{children}</article>
    </div>
  );
}
```

This layout wraps **all pages** under `/blog/*`:
- `/blog` → uses BlogLayout
- `/blog/my-post` → uses BlogLayout
- `/blog/category/tutorials` → uses BlogLayout

---

## Special Files

### page.tsx - Route UI

Defines the unique UI for a route.

```typescript
// app/dashboard/page.tsx
export default function DashboardPage() {
  return <h1>Dashboard</h1>;
}
```

URL: `/dashboard`

### loading.tsx - Loading States

Automatic loading UI with React Suspense.

```typescript
// app/dashboard/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="spinner">
      <p>Loading dashboard...</p>
    </div>
  );
}
```

Shows while `page.tsx` is loading.

### error.tsx - Error Boundaries

Catches errors in page and child segments.

```typescript
// app/dashboard/error.tsx
'use client'; // Error components must be Client Components

export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div>
      <h2>Something went wrong!</h2>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

### not-found.tsx - 404 Pages

Custom 404 page for a segment.

```typescript
// app/blog/not-found.tsx
export default function BlogNotFound() {
  return (
    <div>
      <h2>Blog Post Not Found</h2>
      <Link href="/blog">Back to Blog</Link>
    </div>
  );
}
```

Trigger with:
```typescript
import { notFound } from 'veryfront';

export const getServerData = async (ctx) => {
  const post = await fetchPost(ctx.params.slug);
  if (!post) {
    notFound(); // Shows not-found.tsx
  }
  return { props: { post } };
};
```

---

## Route Groups

Organize routes without affecting URLs using `(folder)` syntax.

```
app/
├── (marketing)/
│   ├── layout.tsx      # Marketing layout
│   ├── page.tsx        # / (home)
│   └── about/
│       └── page.tsx    # /about
└── (shop)/
    ├── layout.tsx      # Shop layout
    ├── products/
    │   └── page.tsx    # /products
    └── cart/
        └── page.tsx    # /cart
```

**URLs:**
- `/` - Uses (marketing) layout
- `/about` - Uses (marketing) layout
- `/products` - Uses (shop) layout
- `/cart` - Uses (shop) layout

**Benefits:**
- Different layouts without URL nesting
- Organize code logically
- Multiple root layouts

---

## Data Fetching

### Server-Side Data

```typescript
// app/blog/[slug]/page.tsx
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await fetchPost(ctx.params.slug);
  return { props: { post } };
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

### Static Generation

```typescript
export const getStaticPaths = async () => {
  const posts = await fetchAllPosts();
  return {
    paths: posts.map(p => ({ params: { slug: p.slug } })),
    fallback: false,
  };
};

export const getServerData = async (ctx) => {
  const post = await fetchPost(ctx.params.slug);
  return { props: { post } };
};
```

---

## Client Components

By default, components are Server Components. Use `'use client'` for client-side interactivity.

```typescript
// app/counter/page.tsx
'use client';

import { useState } from 'react';

export default function CounterPage() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>
        Increment
      </button>
    </div>
  );
}
```

**Use Client Components for:**
- useState, useEffect, other React hooks
- Event listeners (onClick, onChange)
- Browser APIs (localStorage, window)
- Custom hooks

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
    </nav>
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
    await loginUser();
    router.push('/dashboard');
  };

  return <button onClick={handleLogin}>Login</button>;
}
```

### usePathname Hook

```typescript
'use client';

import { usePathname } from 'veryfront';
import { Link } from 'veryfront';

export default function NavLink({ href, children }) {
  const pathname = usePathname();
  const isActive = pathname === href;

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

---

## Parallel Routes

Render multiple pages in the same layout using `@folder` syntax.

```
app/
├── layout.tsx
├── page.tsx
├── @team/
│   └── page.tsx
└── @analytics/
    └── page.tsx
```

```typescript
// app/layout.tsx
export default function Layout({
  children,
  team,
  analytics,
}: {
  children: React.ReactNode;
  team: React.ReactNode;
  analytics: React.ReactNode;
}) {
  return (
    <>
      {children}
      {team}
      {analytics}
    </>
  );
}
```

**Use cases:**
- Dashboard with multiple widgets
- Split views
- Conditional rendering

---

## Intercepting Routes

Intercept navigation to show content in a modal while keeping URL updated.

```
app/
├── feed/
│   └── page.tsx
├── photo/
│   └── [id]/
│       └── page.tsx
└── @modal/
    └── (.)photo/
        └── [id]/
            └── page.tsx
```

**Conventions:**
- `(.)` - Same level
- `(..)` - One level up
- `(..)(..)` - Two levels up
- `(...)` - From root

---

## Metadata

### Static Metadata

```typescript
// app/about/page.tsx
export const metadata = {
  title: 'About Us',
  description: 'Learn more about our company',
};

export default function AboutPage() {
  return <h1>About</h1>;
}
```

### Dynamic Metadata

```typescript
// app/blog/[slug]/page.tsx
export async function generateMetadata({ params }) {
  const post = await fetchPost(params.slug);

  return {
    title: post.title,
    description: post.excerpt,
    openGraph: {
      images: [post.image],
    },
  };
}
```

---

## Best Practices

1. **Use layouts for shared UI** - Navigation, footers, sidebars
2. **Keep Server Components by default** - Only use 'use client' when needed
3. **Colocate files** - Components, styles, tests in route folders
4. **Use loading.tsx** - Better UX with loading states
5. **Handle errors** - Add error.tsx for graceful failures
6. **Optimize images** - Use OptimizedImage component

---

## Common Patterns

### Authentication Layout

```typescript
// app/(auth)/layout.tsx
import { redirect } from 'veryfront';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return <>{children}</>;
}
```

### Blog with Sidebar

```typescript
// app/blog/layout.tsx
export default function BlogLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-4">
      <aside className="col-span-1">
        <SearchBox />
        <Categories />
        <RecentPosts />
      </aside>
      <main className="col-span-3">
        {children}
      </main>
    </div>
  );
}
```

---

## Migration from Pages Router

| Pages Router | App Router |
|--------------|------------|
| `pages/index.tsx` | `app/page.tsx` |
| `pages/about.tsx` | `app/about/page.tsx` |
| `pages/_app.tsx` | `app/layout.tsx` |
| `pages/_document.tsx` | `app/layout.tsx` (html/body) |
| `pages/404.tsx` | `app/not-found.tsx` |

---

## Prerequisites

Before using App Router, ensure you have:
- [Veryfront installed](/learn/installation.md) - Development environment set up
- [Quick Start completed](/learn/quickstart.md) - Basic Veryfront knowledge
- [Routing overview](/guides/routing/README.md) - Understand routing basics
- **React knowledge** - Familiarity with React components and hooks

## Related Guides

### Routing
- [Routing Overview](/guides/routing/README.md) - Compare App Router vs Pages Router
- [Pages Router Guide](./pages-router.md) - Alternative routing system
- [Dynamic Routes](./dynamic-routes.md) - URL parameters and catch-all routes
- [API Routes](./api-routes.md) - Build backend endpoints

### Rendering & Data
- [Rendering Overview](/guides/rendering/README.md) - SSR, SSG, ISR, JIT, RSC
- [SSR Guide](/guides/rendering/ssr.md) - Server-side rendering
- [SSG Guide](/guides/rendering/ssg.md) - Static site generation

### Components & Hooks
- [Link Component](/guides/components/link.md) - Client-side navigation
- [useRouter Hook](/guides/hooks/use-router.md) - Programmatic navigation
- [useParams Hook](/guides/hooks/use-params.md) - Access route parameters

## Reference

### API Reference
- [Functions](/reference/functions/README.md) - Server-side functions
  - [getServerData](/reference/functions/get-server-data.md) - Fetch page data
  - [redirect](/reference/functions/redirect.md) - Server-side redirects
  - [notFound](/reference/functions/not-found.md) - Return 404 errors

### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Router configuration
- [File Conventions](/reference/file-conventions/README.md) - Special App Router files

## Next Steps

1. Build pages with [Dynamic Routes](./dynamic-routes.md)
2. Add backend logic with [API Routes](./api-routes.md)
3. Choose rendering mode in [Rendering Guide](/guides/rendering/README.md)
4. Deploy your app with [Deployment Guides](/guides/deployment/README.md)

## Examples

- [Minimal App Router](/examples/minimal-app-router/) - Simple setup
- [Blog Example](/examples/blog/) - Complete blog with layouts
- [Auth App](/examples/auth-app/) - Authentication patterns

## Troubleshooting

Having routing issues? Check:
- [Debugging Guide](/guides/troubleshooting/debugging.md) - Debug routing problems
- [Troubleshooting](/guides/troubleshooting/README.md) - Common App Router issues
