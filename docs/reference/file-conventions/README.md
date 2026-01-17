---
title: "File Conventions Reference"
category: "reference"
level: "reference"
keywords: ["file-conventions", "routing", "special-files", "page", "layout", "route", "loading", "error"]
ai_summary: "Complete reference for special file names and their purposes in Veryfront's file-based routing system"
related: ["routing/app-router", "routing/pages-router", "api/README"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# File Conventions Reference

Special file names and their purposes in Veryfront's file-based routing system.

## Overview

Veryfront uses file-based routing where special filenames have specific meanings and behaviors. This reference documents all special files for both App Router and Pages Router.

### Convention Types

- **Route Files** - Define routes and UI
- **Layout Files** - Shared UI across routes
- **Data Files** - Server-side data fetching
- **Metadata Files** - SEO and metadata
- **Error Files** - Error handling
- **AI Files** - AI tools and agents

---

## App Router Conventions

Special files for the App Router system (`app/` directory).

### page.tsx

**Purpose:** Defines a unique route and makes a route segment publicly accessible.

**Location:** `app/**/page.tsx`

**Required:** Yes (for each route)

**Type:** Can be Server Component or Client Component

#### Basic Usage

```typescript
// app/page.tsx - Home page (/)
export default function HomePage() {
  return <h1>Home</h1>;
}
```

```typescript
// app/about/page.tsx - About page (/about)
export default function AboutPage() {
  return <h1>About</h1>;
}
```

```typescript
// app/blog/[slug]/page.tsx - Dynamic route (/blog/:slug)
export default function BlogPost() {
  return <h1>Blog Post</h1>;
}
```

#### With Server Data

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

#### Client Component

```typescript
// app/counter/page.tsx
'use client';

import { useState } from 'react';

export default function CounterPage() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>+</button>
    </div>
  );
}
```

**See Also:** [App Router Guide](/guides/routing/app-router.md)

---

### layout.tsx

**Purpose:** Shared UI that wraps multiple pages. Layouts preserve state and remain interactive during navigation.

**Location:** `app/**/layout.tsx`

**Required:** Yes (root layout at `app/layout.tsx`)

**Type:** Can be Server Component or Client Component

#### Root Layout (Required)

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

**Note:** Root layout must include `<html>` and `<body>` tags.

#### Nested Layout

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

#### Layout with Data Fetching

```typescript
// app/dashboard/layout.tsx
import { redirect } from 'veryfront';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div>
      <DashboardNav user={user} />
      {children}
    </div>
  );
}
```

**Behavior:**
- Wraps all child pages and nested layouts
- Does not re-render when navigating between child pages
- Can fetch data asynchronously
- State persists during navigation

**See Also:** [App Router Guide](/guides/routing/app-router.md#layouts)

---

### route.ts

**Purpose:** API endpoint handler for a route segment. Create backend APIs without leaving your app directory.

**Location:** `app/**/route.ts`

**Required:** No

**Type:** Server-only

**Supported HTTP Methods:** GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS

#### Basic API Route

```typescript
// app/api/hello/route.ts
export async function GET(request: Request) {
  return Response.json({ message: 'Hello World' });
}
```

#### With Route Parameters

```typescript
// app/api/users/[id]/route.ts
import type { APIContext } from 'veryfront';

export async function GET(ctx: APIContext) {
  const userId = ctx.params.id;
  const user = await fetchUser(userId);

  if (!user) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }

  return Response.json(user);
}
```

#### Multiple Methods

```typescript
// app/api/posts/route.ts
import type { APIHandler } from 'veryfront';

// List all posts
export const GET: APIHandler = async (ctx) => {
  const posts = await fetchPosts();
  return Response.json(posts);
};

// Create new post
export const POST: APIHandler = async (ctx) => {
  const body = await ctx.request.json();
  const post = await createPost(body);
  return Response.json(post, { status: 201 });
};

// Update post
export const PUT: APIHandler = async (ctx) => {
  const body = await ctx.request.json();
  const post = await updatePost(body);
  return Response.json(post);
};

// Delete post
export const DELETE: APIHandler = async (ctx) => {
  await deletePost(ctx.params.id);
  return new Response(null, { status: 204 });
};
```

#### With Authentication

```typescript
// app/api/protected/route.ts
import { getSession } from '@/lib/auth';

export async function GET(request: Request) {
  const session = await getSession(request);

  if (!session) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return Response.json({ user: session.user });
}
```

**Behavior:**
- Cannot coexist with `page.tsx` in the same directory
- Automatically sets `Content-Type: application/json` when using `Response.json()`
- Context includes: `params`, `query`, `request`, `headers`

**See Also:** [API Routes Guide](/guides/routing/api-routes.md)

---

### loading.tsx

**Purpose:** Loading UI for a route segment. Shown during data fetching and navigation.

**Location:** `app/**/loading.tsx`

**Required:** No

**Type:** Client Component (automatically wrapped with Suspense)

#### Basic Loading State

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

#### With Skeleton UI

```typescript
// app/blog/loading.tsx
export default function BlogLoading() {
  return (
    <div className="skeleton">
      <div className="skeleton-title" />
      <div className="skeleton-text" />
      <div className="skeleton-text" />
      <div className="skeleton-text" />
    </div>
  );
}
```

**Behavior:**
- Automatically wraps `page.tsx` with React Suspense
- Shows while page is loading (data fetching, code splitting)
- Replaced with actual page content when ready
- Allows UI to render immediately while content loads

**See Also:** [App Router Guide](/guides/routing/app-router.md#loading-states)

---

### error.tsx

**Purpose:** Error UI boundary for a route segment. Catches errors in page and child segments.

**Location:** `app/**/error.tsx`

**Required:** No

**Type:** Client Component (must use `'use client'`)

#### Basic Error Boundary

```typescript
// app/dashboard/error.tsx
'use client';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
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

#### With Error Logging

```typescript
// app/error.tsx
'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to error tracking service
    console.error('Application error:', error);
  }, [error]);

  return (
    <div>
      <h1>Oops! Something went wrong</h1>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

**Behavior:**
- Catches errors in child page components
- Does not catch errors in `layout.tsx` (use root `error.tsx`)
- `reset()` function attempts to re-render the segment
- Automatically wrapped with React Error Boundary

**Props:**
- `error: Error` - The error that was thrown
- `reset: () => void` - Function to attempt recovery

**See Also:** [Error Handling](/reference/functions/README.md#error-handling)

---

### not-found.tsx

**Purpose:** Custom 404 UI for a route segment.

**Location:** `app/**/not-found.tsx`

**Required:** No

**Type:** Server Component or Client Component

#### Basic 404 Page

```typescript
// app/not-found.tsx
import { Link } from 'veryfront';

export default function NotFound() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <p>The page you're looking for doesn't exist.</p>
      <Link href="/">Go home</Link>
    </div>
  );
}
```

#### Segment-Specific 404

```typescript
// app/blog/not-found.tsx
import { Link } from 'veryfront';

export default function BlogNotFound() {
  return (
    <div>
      <h2>Blog Post Not Found</h2>
      <p>This blog post doesn't exist or has been removed.</p>
      <Link href="/blog">Back to Blog</Link>
    </div>
  );
}
```

#### Triggered from Server Data

```typescript
// app/blog/[slug]/page.tsx
import { notFound } from 'veryfront';

export const getServerData = async (ctx) => {
  const post = await fetchPost(ctx.params.slug);

  if (!post) {
    notFound(); // Shows app/blog/not-found.tsx or app/not-found.tsx
  }

  return { props: { post } };
};
```

**Behavior:**
- Automatically invoked for non-existent routes
- Can be manually triggered with `notFound()` function
- Falls back to parent segment's `not-found.tsx` if not found
- Falls back to default 404 if no custom page exists

---

### template.tsx

**Purpose:** Similar to `layout.tsx` but creates a new instance on navigation (does not preserve state).

**Location:** `app/**/template.tsx`

**Required:** No

**Type:** Server Component or Client Component

#### Basic Template

```typescript
// app/template.tsx
export default function Template({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="fade-in">{children}</div>;
}
```

**Difference from Layout:**
- Layout: State persists, doesn't re-render
- Template: New instance on navigation, re-renders

**Use Cases:**
- Page transitions/animations
- Reset component state on navigation
- Enter/exit animations

**See Also:** [App Router Guide](/guides/routing/app-router.md)

---

### global-error.tsx

**Purpose:** Global error boundary that catches errors in root layout.

**Location:** `app/global-error.tsx`

**Required:** No

**Type:** Client Component

```typescript
// app/global-error.tsx
'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <h1>Application Error</h1>
        <p>Something went wrong at the root level.</p>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
```

**Note:** Must include `<html>` and `<body>` tags since it catches errors in root layout.

---

## Pages Router Conventions

Special files for the Pages Router system (`pages/` directory).

### index.tsx

**Purpose:** Default page for a directory.

**Location:** `pages/**/index.tsx`

**Maps to:** Directory path

#### Examples

```typescript
// pages/index.tsx → /
export default function HomePage() {
  return <h1>Home</h1>;
}
```

```typescript
// pages/blog/index.tsx → /blog
export default function BlogPage() {
  return <h1>Blog</h1>;
}
```

```typescript
// pages/docs/index.tsx → /docs
export default function DocsPage() {
  return <h1>Documentation</h1>;
}
```

**Behavior:**
- Maps to the directory path without filename
- `pages/index.tsx` → `/`
- `pages/about/index.tsx` → `/about`

---

### _app.tsx

**Purpose:** Custom App component that wraps all pages. Used for global layouts and initialization.

**Location:** `pages/_app.tsx`

**Required:** No

**Type:** Client Component

#### Basic _app.tsx

```typescript
// pages/_app.tsx
import type { AppProps } from 'veryfront';
import '../styles/global.css';

export default function App({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
```

#### With Global Layout

```typescript
// pages/_app.tsx
import type { AppProps } from 'veryfront';
import { Layout } from '@/components/Layout';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Layout>
      <Component {...pageProps} />
    </Layout>
  );
}
```

#### With Multiple Layouts

```typescript
// pages/_app.tsx
import type { AppProps } from 'veryfront';
import { useRouter } from 'veryfront';

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const isDashboard = router.pathname.startsWith('/dashboard');

  return (
    <>
      {isDashboard ? (
        <DashboardLayout>
          <Component {...pageProps} />
        </DashboardLayout>
      ) : (
        <MainLayout>
          <Component {...pageProps} />
        </MainLayout>
      )}
    </>
  );
}
```

**Use Cases:**
- Global CSS imports
- Persistent layouts
- Global state providers
- Authentication wrappers
- Analytics integration
- Error boundaries

**See Also:** [Pages Router Guide](/guides/routing/pages-router.md#custom-app)

---

### _document.tsx

**Purpose:** Custom Document to augment HTML structure. Server-side only.

**Location:** `pages/_document.tsx`

**Required:** No

**Type:** Server-only

#### Basic _document.tsx

```typescript
// pages/_document.tsx
import { Html, Head, Main, NextScript } from 'veryfront/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <meta charSet="UTF-8" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
```

#### With External Resources

```typescript
// pages/_document.tsx
import { Html, Head, Main, NextScript } from 'veryfront/document';

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
        <script
          async
          src="https://www.googletagmanager.com/gtag/js?id=GA_TRACKING_ID"
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

**Use Cases:**
- Custom HTML attributes
- External fonts
- Third-party scripts
- Custom meta tags

**Important:**
- Only rendered on server
- Don't use React hooks or event handlers
- Use `_app.tsx` for client-side logic

**See Also:** [Pages Router Guide](/guides/routing/pages-router.md#custom-document)

---

### _error.tsx

**Purpose:** Custom error page for runtime errors.

**Location:** `pages/_error.tsx`

**Required:** No

**Type:** Server Component or Client Component

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

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};
```

**Behavior:**
- Called when runtime error occurs
- Different from 404.tsx (which is for missing routes)

---

### 404.tsx

**Purpose:** Custom 404 page for missing routes.

**Location:** `pages/404.tsx`

**Required:** No

**Type:** Server Component or Client Component

```typescript
// pages/404.tsx
import { Link } from 'veryfront';

export default function Custom404() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <Link href="/">Go home</Link>
    </div>
  );
}
```

**Behavior:**
- Automatically used for non-existent routes
- Static by default (pre-rendered at build time)

---

### 500.tsx

**Purpose:** Custom 500 error page for server errors.

**Location:** `pages/500.tsx`

**Required:** No

**Type:** Server Component or Client Component

```typescript
// pages/500.tsx
export default function Custom500() {
  return (
    <div>
      <h1>500 - Server Error</h1>
      <p>Something went wrong on our end.</p>
    </div>
  );
}
```

---

## Dynamic Route Patterns

### [param]

**Purpose:** Single dynamic segment.

**Pattern:** `[param]` or `[slug]` or `[id]`

**Examples:**

```typescript
// pages/blog/[slug].tsx → /blog/:slug
// pages/users/[id].tsx → /users/:id
// pages/posts/[postId].tsx → /posts/:postId
```

**Access parameter:**

```typescript
// Pages Router
export const getServerData = async (ctx) => {
  const slug = ctx.params.slug;
  // ...
};

// App Router
export const getServerData = async (ctx) => {
  const slug = ctx.params.slug;
  // ...
};
```

**See Also:** [Dynamic Routes](/guides/routing/dynamic-routes.md)

---

### [...slug]

**Purpose:** Catch-all route segment. Matches one or more segments.

**Pattern:** `[...slug]` or `[...path]`

**Examples:**

```typescript
// pages/docs/[...slug].tsx
// Matches:
// /docs/getting-started → slug = ['getting-started']
// /reference/routes → slug = ['api', 'routes']
// /docs/guide/advanced/patterns → slug = ['guide', 'advanced', 'patterns']
// Does NOT match: /docs (empty segments)
```

**Access parameters:**

```typescript
export const getServerData = async (ctx) => {
  const slug = ctx.params.slug; // string[]
  const path = slug.join('/');
  // ...
};
```

---

### [[...slug]]

**Purpose:** Optional catch-all route segment. Matches zero or more segments.

**Pattern:** `[[...slug]]` or `[[...path]]`

**Examples:**

```typescript
// pages/blog/[[...slug]].tsx
// Matches:
// /blog → slug = undefined
// /blog/2024 → slug = ['2024']
// /blog/2024/january → slug = ['2024', 'january']
```

**Access parameters:**

```typescript
export const getServerData = async (ctx) => {
  const slug = ctx.params.slug; // string[] | undefined

  if (!slug) {
    // Handle /blog
  } else {
    // Handle /blog/...
  }
};
```

---

## Route Groups

**Purpose:** Organize routes without affecting URL structure.

**Pattern:** `(folder-name)`

**Example:**

```
app/
├── (marketing)/
│   ├── page.tsx        → /
│   └── about/
│       └── page.tsx    → /about
└── (shop)/
    ├── products/
    │   └── page.tsx    → /products
    └── cart/
        └── page.tsx    → /cart
```

**Benefits:**
- Different layouts without URL nesting
- Logical code organization
- Multiple root layouts

**Note:** Only works in App Router

**See Also:** [App Router Guide](/guides/routing/app-router.md#route-groups)

---

## Parallel Routes

**Purpose:** Render multiple pages in the same layout.

**Pattern:** `@folder-name`

**Example:**

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

**Use Cases:**
- Dashboard with multiple widgets
- Split views
- Conditional slot rendering

**Note:** Only works in App Router

**See Also:** [App Router Guide](/guides/routing/app-router.md#parallel-routes)

---

## Intercepting Routes

**Purpose:** Intercept navigation to show content in a modal while keeping URL updated.

**Patterns:**
- `(.)` - Same level
- `(..)` - One level up
- `(..)(..)` - Two levels up
- `(...)` - From root

**Example:**

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

**Use Cases:**
- Modal routes
- Overlays
- Preserving background content

**Note:** Only works in App Router

**See Also:** [App Router Guide](/guides/routing/app-router.md#intercepting-routes)

---

## AI Conventions

Special files for AI features.

### ai/tools/*.ts

**Purpose:** Auto-discovered tool definitions.

**Location:** `ai/tools/**/*.ts`

**Pattern:** Each file exports a tool definition

```typescript
// ai/tools/search.ts
import { tool } from 'veryfront/tool';
import { z } from 'zod';

export default tool({
  description: 'Search for information',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    return await searchAPI(query);
  },
});
```

**Behavior:**
- Automatically discovered and registered
- Tool name derived from filename
- Available to all agents

**See Also:** [AI Specification](../../ai/specification.md)

---

### ai/agents/*.ts

**Purpose:** Auto-discovered agent definitions.

**Location:** `ai/agents/**/*.ts`

**Pattern:** Each file exports an agent definition

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/agent';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant',
  tools: {
    search: true,  // References auto-discovered tool
  },
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
```

**Behavior:**
- Automatically discovered and registered
- Agent name derived from filename
- Can reference tools by name

---

### ai/resources/*

**Purpose:** Auto-discovered MCP resources.

**Location:** `ai/resources/**/*`

**Pattern:** Markdown, JSON, or other data files

```markdown
<!-- ai/resources/company-info.md -->
# Company Information

Founded: 2024
Location: San Francisco
```

**Behavior:**
- Exposed via MCP server
- Available to agents and external MCP clients
- Supports various file formats

---

### ai/prompts/*.ts

**Purpose:** Reusable prompt templates.

**Location:** `ai/prompts/**/*.ts`

```typescript
// ai/prompts/code-review.ts
export const codeReviewPrompt = `
Review the following code and provide feedback:

{code}

Focus on:
- Best practices
- Performance
- Security
- Readability
`;
```

**Behavior:**
- Not automatically registered
- Import and use in agents or API routes
- Supports template variables

---

## Metadata Files

### favicon.ico

**Location:** `public/favicon.ico` or `app/favicon.ico`

**Automatic handling:** Automatically served at `/favicon.ico`

---

### sitemap.xml

**Location:** `public/sitemap.xml`

**Manual generation:** Create in `public/` directory

```xml
<!-- public/sitemap.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2025-01-01</lastmod>
  </url>
</urlset>
```

---

### robots.txt

**Location:** `public/robots.txt`

```
# public/robots.txt
User-agent: *
Allow: /
Sitemap: https://example.com/sitemap.xml
```

---

## Configuration Files

### veryfront.config.ts

**Purpose:** Main configuration file.

**Location:** Project root

**See:** [Configuration Reference](../configuration/README.md)

---

### middleware.ts

**Purpose:** Edge middleware for request/response manipulation.

**Location:** Project root or `src/middleware.ts`

```typescript
// middleware.ts
import type { NextRequest } from 'veryfront';

export function middleware(request: NextRequest) {
  // Modify request/response
  const response = NextResponse.next();
  response.headers.set('X-Custom-Header', 'value');
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

**See Also:** [Middleware API](/reference/functions/README.md#middleware-experimental)

---

## TypeScript Configuration Files

### tsconfig.json

**Purpose:** TypeScript configuration (Node.js, Bun).

**Location:** Project root

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["veryfront/types"]
  }
}
```

---

### deno.json

**Purpose:** Deno configuration and imports.

**Location:** Project root

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0",
    "react": "npm:react@^18.3.0"
  }
}
```

---

## Directory Conventions

### public/

**Purpose:** Static assets served directly.

**Location:** Project root

**Contents:**
- Images
- Fonts
- Static files
- robots.txt
- sitemap.xml

**Served at:** `/` (root URL)

**Example:**
```
public/
├── images/
│   └── logo.png    → /images/logo.png
├── fonts/
│   └── inter.woff2 → /fonts/inter.woff2
└── favicon.ico     → /favicon.ico
```

---

### styles/ or app/styles/

**Purpose:** Global CSS and stylesheets.

**Typical structure:**
```
styles/
├── globals.css
├── variables.css
└── components/
    ├── button.css
    └── card.css
```

**Import in `_app.tsx` or `layout.tsx`:**
```typescript
import '@/styles/globals.css';
```

---

## File Naming Best Practices

### Use kebab-case for files

```
✅ blog-post.tsx
✅ user-profile.tsx
❌ BlogPost.tsx
❌ userProfile.tsx
```

### Use PascalCase for components

```typescript
// ✅ Good
export default function BlogPost() { }

// ❌ Avoid
export default function blogPost() { }
```

### Descriptive names for dynamic routes

```
✅ [userId].tsx
✅ [postSlug].tsx
❌ [id].tsx (too generic)
❌ [x].tsx (unclear)
```

---

## Quick Reference

### App Router Files

| File | Purpose | Required |
|------|---------|----------|
| `page.tsx` | Route UI | Yes (for route) |
| `layout.tsx` | Shared UI wrapper | Yes (root only) |
| `loading.tsx` | Loading UI | No |
| `error.tsx` | Error boundary | No |
| `not-found.tsx` | 404 page | No |
| `template.tsx` | Re-rendered wrapper | No |
| `route.ts` | API endpoint | No |
| `global-error.tsx` | Root error boundary | No |

### Pages Router Files

| File | Purpose | Required |
|------|---------|----------|
| `index.tsx` | Default page | No |
| `_app.tsx` | Custom App | No |
| `_document.tsx` | Custom Document | No |
| `_error.tsx` | Error page | No |
| `404.tsx` | 404 page | No |
| `500.tsx` | 500 page | No |

### Dynamic Routes

| Pattern | Matches | Example |
|---------|---------|---------|
| `[param]` | Single segment | `/blog/:slug` |
| `[...slug]` | One or more | `/docs/a/b/c` |
| `[[...slug]]` | Zero or more | `/blog` or `/blog/a` |

### Special Directories

| Directory | Purpose |
|-----------|---------|
| `(group)` | Route group (no URL) |
| `@slot` | Parallel route |
| `(.)folder` | Intercept same level |
| `(..)folder` | Intercept parent level |

---

## See Also

- [App Router Guide](/guides/routing/app-router.md) - Detailed App Router documentation
- [Pages Router Guide](/guides/routing/pages-router.md) - Detailed Pages Router documentation
- [Dynamic Routes](/guides/routing/dynamic-routes.md) - Dynamic route patterns
- [API Routes](/guides/routing/api-routes.md) - Backend endpoints
- [CLI Reference](../cli/README.md) - Command-line interface
- [Configuration Reference](../configuration/README.md) - Config options
