---
title: "API Reference"
category: "api"
level: "reference"
keywords: ["api", "reference", "types", "functions", "components", "configuration"]
ai_summary: "Complete API reference for Veryfront including configuration, components, data fetching, routing, and types"
related: ["api/configuration", "api/components", "api/data-fetching", "api/routes"]
version: "0.1.0"
last_updated: "2025-12-07"
---

# API Reference

This reference documents all public APIs, types, and interfaces in Veryfront.

## Contents

| Section | Description |
|---------|-------------|
| [Configuration](#configuration) | Project configuration options |
| [Components](#components) | Built-in React components |
| [Data Fetching](#data-fetching) | Server-side data loading |
| [Routing](#routing) | File-based routing APIs |
| [API Routes](#api-routes) | HTTP endpoint handlers |
| [Types](#types) | TypeScript definitions |
| [AI APIs](#ai-apis-beta) | Agents, tools, and integrations |
| [Runtime](#runtime-apis) | Platform-specific APIs |

## Configuration

Configure Veryfront using `veryfront.config.ts` at the root of your project.

```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  // Project settings
  projectName: 'my-app',
  runtime: 'deno', // 'deno' | 'node' | 'bun' | 'cloudflare'

  // Rendering defaults
  rendering: {
    default: 'ssr', // 'ssr' | 'ssg' | 'isr' | 'jit'
  },

  // Router type
  router: 'app', // 'app' | 'pages' (auto-detected)

  // Build settings
  build: {
    outDir: '.veryfront',
    sourcemap: true,
  },

  // AI configuration
  ai: {
    enabled: true,
    defaultProvider: 'anthropic',
  },
});
```

**Full reference:** [Configuration API](/reference/configuration/README.md)

---

## Components

### `<Link>`

Client-side navigation without page reloads.

```typescript
import { Link } from 'veryfront';

<Link href="/about">About</Link>
<Link href="/blog/post-1" prefetch={true}>Blog Post</Link>
```

**Props:**
- `href: string` (required) - Destination URL
- `prefetch?: boolean` - Prefetch on hover (default: false)
- `replace?: boolean` - Replace history instead of push
- `scroll?: boolean` - Scroll to top on navigation (default: true)
- `className?: string` - CSS class name
- `children: React.ReactNode` - Link content

---

### `<Head>`

Modify document `<head>` from any component.

```typescript
import { Head } from 'veryfront';

<Head>
  <title>My Page Title</title>
  <meta name="description" content="Page description" />
  <meta property="og:image" content="/image.jpg" />
  <link rel="canonical" href="https://example.com/page" />
</Head>
```

**Supports:**
- `<title>` - Page title
- `<meta>` - Meta tags
- `<link>` - Links (stylesheets, canonical, etc.)
- `<script>` - External scripts
- `<style>` - Inline styles

---

### `<OptimizedImage>`

Optimized image component with lazy loading and format conversion.

```typescript
import { OptimizedImage } from 'veryfront';

<OptimizedImage
  src="/photo.jpg"
  alt="Description"
  width={800}
  height={600}
  quality={85}
  format="webp"
  loading="lazy"
/>
```

**Props:**
- `src: string` (required) - Image source
- `alt: string` (required) - Alt text
- `width?: number` - Image width
- `height?: number` - Image height
- `quality?: number` - Image quality (1-100, default: 80)
- `format?: 'webp' | 'avif' | 'jpeg' | 'png'` - Output format
- `loading?: 'lazy' | 'eager'` - Loading strategy (default: 'lazy')
- `priority?: boolean` - Load image with high priority
- `className?: string` - CSS class name
- `style?: React.CSSProperties` - Inline styles

**Full reference:** [Components API](/reference/components/README.md)

---

## Data Fetching

### `getServerData`

Fetch data on the server for SSR, SSG, ISR, or JIT rendering.

```typescript
import type { DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const { params, query, request, headers } = ctx;

  // Fetch your data
  const data = await fetchData(params.id);

  // Return props
  return { props: { data } };
};
```

**Context API:**

```typescript
interface DataContext<Params = Record<string, string>> {
  params: Params;           // URL parameters from dynamic routes
  query: URLSearchParams;   // Query string parameters
  request: Request;         // Web standard Request object
  headers: Headers;         // Request headers
  url: URL;                // Parsed URL
}
```

**Return values:**

```typescript
// Success with data
return { props: { data } };

// 404 Not Found
return { notFound: true };

// Redirect
return {
  redirect: {
    destination: '/new-url',
    permanent: false, // or true for 301
  },
};

// With caching (ISR)
return {
  props: { data },
  revalidate: 3600, // Revalidate every hour
};

// With permanent cache (JIT)
return {
  props: { data },
  cache: 'forever',
};

// With custom headers
return {
  props: { data },
  headers: {
    'Cache-Control': 'public, max-age=60',
  },
};
```

---

### `getStaticPaths`

Define which paths to pre-render for dynamic routes (SSG).

```typescript
import type { GetStaticPaths } from 'veryfront';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetchAllPosts();

  return {
    paths: posts.map(post => ({
      params: { slug: post.slug }
    })),
    fallback: false, // false | true | 'blocking'
  };
};
```

**Fallback modes:**
- `false` - 404 for paths not in `paths` array
- `true` - Show fallback UI, then generate page
- `'blocking'` - Wait for page generation (no fallback UI)

---

### `notFound()`

Return 404 from server-side data fetching.

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

---

### `redirect()`

Server-side redirect from data fetching.

```typescript
import { redirect } from 'veryfront';

export const getServerData = async (ctx) => {
  const user = await getUser(ctx.request);

  if (!user) {
    return redirect('/login');
  }

  return { props: { user } };
};

// Permanent redirect (301)
return redirect('/new-url', { permanent: true });
```

**Full reference:** [Data Fetching API](/reference/functions/get-server-data.md)

---

## Routing

### Dynamic Imports

Code-split components with dynamic imports.

```typescript
import dynamic from 'veryfront/dynamic';

const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <p>Loading...</p>,
  ssr: true, // Server-side render (default: true)
});

export default function Page() {
  return <HeavyComponent />;
}
```

---

### `useRouter`

Access router from client components.

```typescript
'use client'; // App Router requires this

import { useRouter } from 'veryfront';

export default function Navigation() {
  const router = useRouter();

  const navigate = () => {
    router.push('/dashboard');
    // router.replace('/dashboard'); // Replace instead of push
    // router.back(); // Go back
    // router.forward(); // Go forward
    // router.refresh(); // Refresh current page
  };

  return <button onClick={navigate}>Go to Dashboard</button>;
}
```

**Router API:**
- `push(url: string)` - Navigate to URL
- `replace(url: string)` - Replace current URL
- `back()` - Go back in history
- `forward()` - Go forward in history
- `refresh()` - Refresh current page
- `prefetch(url: string)` - Prefetch a route

---

### `usePathname`

Get current pathname (App Router only).

```typescript
'use client';

import { usePathname } from 'veryfront';

export default function ActiveLink({ href, children }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link href={href} className={isActive ? 'active' : ''}>
      {children}
    </Link>
  );
}
```

---

### `useParams`

Access route params from client components.

```typescript
'use client';

import { useParams } from 'veryfront';

export default function BlogPost() {
  const params = useParams();
  // params.slug for [slug]
  // params.slug[] for [...slug]

  return <div>Post: {params.slug}</div>;
}
```

---

### `useSearchParams`

Access query string parameters.

```typescript
'use client';

import { useSearchParams } from 'veryfront';

export default function Search() {
  const searchParams = useSearchParams();
  const query = searchParams.get('q'); // ?q=search-term

  return <div>Search: {query}</div>;
}
```

**Full reference:** [Routes API](/guides/routing/api-routes.md)

---

## API Routes

### App Router API Routes

```typescript
// app/api/hello/route.ts
import type { APIHandler } from 'veryfront';

export const GET: APIHandler = async (ctx) => {
  const { params, query, request } = ctx;

  return Response.json({ message: 'Hello' });
};

export const POST: APIHandler = async (ctx) => {
  const body = await ctx.request.json();

  return Response.json({ received: body }, { status: 201 });
};

// Supported methods: GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS
```

---

### Pages Router API Routes

```typescript
// pages/api/hello.ts
import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    res.status(200).json({ message: 'Hello' });
  } else if (req.method === 'POST') {
    res.status(201).json({ received: req.body });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
```

**Full reference:** [API Routes](/guides/routing/api-routes.md)

---

## Types

### Page Types

```typescript
import type { PageWithData, PageProps } from 'veryfront';

// Page with data fetching
const Page: PageWithData<{ data: MyData }> = ({ data }) => {
  return <div>{data.title}</div>;
};

// Page without data
const SimplePage: React.FC = () => {
  return <div>Hello</div>;
};

// Page props type
interface Props extends PageProps {
  data: MyData;
}
```

---

### Data Context

```typescript
import type { DataContext } from 'veryfront';

// Generic params
export const getServerData = async (ctx: DataContext) => {
  // ctx.params is Record<string, string | string[]>
};

// Typed params
type Params = {
  slug: string;
  category: string;
};

export const getServerData = async (ctx: DataContext<Params>) => {
  // ctx.params.slug is string
  // ctx.params.category is string
};
```

---

### API Handler Types

```typescript
import type { APIHandler, APIContext } from 'veryfront';

export const GET: APIHandler = async (ctx: APIContext) => {
  const { params, query, request } = ctx;
  return Response.json({ data });
};
```

---

### Configuration Types

```typescript
import type { VeryfrontConfig } from 'veryfront';

const config: VeryfrontConfig = {
  projectName: 'my-app',
  runtime: 'deno',
  rendering: {
    default: 'ssr',
  },
};
```

---

## Runtime APIs

### Platform Detection

```typescript
import { isPlatform } from 'veryfront/runtime';

if (isPlatform('deno')) {
  // Deno-specific code
} else if (isPlatform('node')) {
  // Node.js-specific code
}
```

---

### Environment Variables

```typescript
// Access env vars (works across all runtimes)
const apiKey = process.env.API_KEY;

// Or use compat helpers
import { getEnv } from 'veryfront/platform/compat/process.ts';
const apiKey = getEnv('API_KEY');
```

---

### File System (Server-side)

```typescript
// App Router: Use in getServerData or Server Components
export const getServerData = async () => {
  const fs = await getAdapter().then((adapter) => adapter.fs);
  const content = await fs.readFile('./data.json');
  return { props: { content } };
};

// Pages Router: Use in getServerData
export const getServerData = async () => {
  const fs = await import('node:fs/promises');
  const content = await fs.readFile('./data.json', 'utf-8');
  return { props: { content } };
};
```

---

## Middleware (Experimental)

```typescript
// middleware.ts (root of project)
import type { NextRequest } from 'veryfront';

export function middleware(request: NextRequest) {
  // Modify request/response
  const response = NextResponse.next();

  // Add custom header
  response.headers.set('X-Custom-Header', 'value');

  // Redirect
  if (request.nextUrl.pathname === '/old-path') {
    return NextResponse.redirect(new URL('/new-path', request.url));
  }

  return response;
}

// Specify which routes to run middleware on
export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

---

## AI APIs (Beta)

### Agent System

```typescript
import { agent } from 'veryfront/ai';

const assistant = agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: ['gmail/*', 'calendar/*'], // Use integration tools
});

const response = await assistant.generate('Summarize my emails');
console.log(response.text);
```

### Service Integrations

Veryfront includes 50+ pre-built integrations with 235 AI tools:

```bash
# Add integrations when initializing
veryfront init my-project --integrations gmail,slack,notion
```

**Available Categories:**
- **Communication**: Gmail, Slack, Outlook, Teams, Discord, Zoom, Twilio
- **Productivity**: Calendar, Notion, Jira, Linear, Asana, Trello
- **Development**: GitHub, GitLab, Bitbucket, Sentry
- **Data**: Google Drive, Sheets, Dropbox, Airtable, Supabase
- **CRM/Sales**: Salesforce, HubSpot, Pipedrive
- **Support**: Zendesk, Intercom, Freshdesk
- **Finance**: Stripe, QuickBooks, Xero

**Full reference:** [Integrations](/reference/ai/integrations.md)

### Tool Definition

```typescript
import { defineTool } from 'veryfront/ai';

export const calculator = defineTool({
  name: 'calculator',
  description: 'Performs basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string' },
    },
    required: ['expression'],
  },
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  },
});
```

**Full reference:** [AI API Documentation](../ai/specification.md)

---

## Utilities

### `generateStaticParams` (App Router)

App Router equivalent of `getStaticPaths`.

```typescript
// app/blog/[slug]/page.tsx
export async function generateStaticParams() {
  const posts = await fetchAllPosts();

  return posts.map(post => ({
    slug: post.slug,
  }));
}
```

---

### `headers()` (App Router Server Components)

Access request headers in Server Components.

```typescript
import { headers } from 'veryfront/headers';

export default async function Page() {
  const headersList = headers();
  const userAgent = headersList.get('user-agent');

  return <div>User Agent: {userAgent}</div>;
}
```

---

### `cookies()` (App Router Server Components)

Access cookies in Server Components.

```typescript
import { cookies } from 'veryfront/cookies';

export default async function Page() {
  const cookieStore = cookies();
  const theme = cookieStore.get('theme');

  return <div>Theme: {theme?.value}</div>;
}
```

---

## Error Handling

### Custom Error Pages

**App Router:**

```typescript
// app/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div>
      <h1>Something went wrong!</h1>
      <p>{error.message}</p>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
```

**Pages Router:**

```typescript
// pages/_error.tsx
function Error({ statusCode }) {
  return (
    <p>
      {statusCode
        ? `An error ${statusCode} occurred on server`
        : 'An error occurred on client'}
    </p>
  );
}

Error.getInitialProps = ({ res, err }) => {
  const statusCode = res ? res.statusCode : err ? err.statusCode : 404;
  return { statusCode };
};

export default Error;
```

---

### Custom 404 Pages

**App Router:**

```typescript
// app/not-found.tsx
export default function NotFound() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <Link href="/">Go home</Link>
    </div>
  );
}
```

**Pages Router:**

```typescript
// pages/404.tsx
export default function Custom404() {
  return (
    <div>
      <h1>404 - Page Not Found</h1>
      <Link href="/">Go home</Link>
    </div>
  );
}
```

---

## TypeScript Config

Recommended `tsconfig.json` for Veryfront projects:

```json
{
  "compilerOptions": {
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "module": "ESNext",
    "target": "ES2022",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["veryfront/types"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", ".veryfront"]
}
```

For Deno projects, use `deno.json`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react",
    "lib": ["DOM", "DOM.Iterable", "ES2022"]
  },
  "imports": {
    "veryfront": "./node_modules/veryfront/mod.ts",
    "react": "npm:react@^18.3.0",
    "react-dom": "npm:react-dom@^18.3.0"
  }
}
```

---

## Related Documentation

- [Configuration Guide](/reference/configuration/README.md) - Complete configuration reference
- [Components Guide](/reference/components/README.md) - Component API details
- [Data Fetching Guide](/reference/functions/get-server-data.md) - Data fetching patterns
- [Routes Guide](/guides/routing/api-routes.md) - Routing and API routes
- [Routing System](/guides/routing/README.md) - File-based routing overview
- [Rendering Modes](/guides/rendering/README.md) - Rendering strategies

---

## Migration Guides

### From Next.js

Veryfront is designed to be largely compatible with Next.js. Most code works with minimal changes:

**What works out of the box:**
- ✅ File-based routing (App Router and Pages Router)
- ✅ Dynamic routes with `[slug]` syntax
- ✅ `getServerSideProps` → use `getServerData` instead
- ✅ `getStaticProps` + `getStaticPaths` → same API
- ✅ API routes (both App and Pages Router styles)
- ✅ `<Link>` and `<Head>` components
- ✅ `useRouter`, `usePathname`, `useParams`

**What needs changes:**
- ⚠️ Image optimization: Use `<OptimizedImage>` instead of `next/image`
- ⚠️ Font optimization: Manual setup required
- ⚠️ Environment variables: Use `process.env` or compat `getEnv()`

**What's not supported:**
- ❌ `getServerSideProps` / `getStaticProps` names (use `getServerData`)
- ❌ Next.js-specific config options
- ❌ Incremental Static Regeneration with `revalidate` (use Veryfront's ISR)

---

## Examples

See working examples in the repository:

**API Examples:**
- [Minimal App Router](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-app-router) - Basic App Router setup
- [Minimal Pages](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-pages) - Basic Pages Router setup
- [Data Fetching Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/data-fetching-demo) - All data fetching patterns
- [API Routes](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app) - API endpoints with authentication
- [Form Handling](https://github.com/veryfrontjs/veryfront/tree/main/examples/form-handling) - Forms with server actions

**Component Examples:**
- [Image Optimization](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - OptimizedImage usage
- [Dynamic Imports](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-app-router) - Code splitting

**AI Examples:**
- [AI Basic](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-basic) - Simple agent integration
- [Code Assistant](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-code-assistant) - AI-powered tools

---

## Getting Help

- **Documentation:** [docs.veryfront.com](/)
- **Examples:** Check the `/examples/` directory
- **Issues:** Report bugs on GitHub
- **Quick Start:** [5-minute quickstart guide](/learn/quickstart.md)
