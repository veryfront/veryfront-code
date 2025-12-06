---
title: Quick Start
description: Build your first Veryfront application in 30 minutes
category: learn
level: beginner
keywords:
  - quickstart
  - tutorial
  - getting started
  - first app
reading_time: 30 min
prev_page: /learn/installation.md
next_page: /guides/routing/overview.md
---

# Quick Start

Build your first Veryfront application in 30 minutes. This tutorial covers both traditional React apps and agent-powered features.

## Prerequisites

- [Deno installed](/learn/installation.md) (recommended) or Node.js 18+
- Basic knowledge of React and TypeScript
- A code editor (VS Code recommended)

## Part 1: Traditional React App

Build a standard React application with routing and data fetching.

### Step 1: Create Project

```bash
# Create and navigate to project directory
mkdir my-blog && cd my-blog

# Initialize Deno project
deno init

# Install dependencies
deno add @veryfront/core react react-dom
```

### Step 2: Configure Project

**deno.json:**
```json
{
  "tasks": {
    "dev": "deno run --allow-all --watch src/main.ts",
    "build": "veryfront build",
    "start": "veryfront start"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "jsr:@veryfront/core@^0.1.0",
    "veryfront/": "jsr:@veryfront/core@^0.1.0/",
    "react": "npm:react@^18.3.0",
    "react-dom": "npm:react-dom@^18.3.0"
  }
}
```

**veryfront.config.ts:**
```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  title: 'My Blog',
  runtime: 'deno',
  dev: {
    port: 3000,
    hmr: true,
  },
});
```

### Step 3: Create Home Page

**app/page.tsx:**
```tsx
import { Head, Link } from 'veryfront';

export default function HomePage() {
  return (
    <>
      <Head>
        <title>My Blog</title>
        <meta name="description" content="Welcome to my blog" />
      </Head>

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>Welcome to My Blog</h1>
        <p>A modern React blog built with Veryfront</p>

        <nav>
          <Link href="/about">About</Link>
          {' | '}
          <Link href="/blog">Blog Posts</Link>
        </nav>
      </main>
    </>
  );
}
```

### Step 4: Add More Pages

**app/about/page.tsx:**
```tsx
import { Head, Link } from 'veryfront';

export default function AboutPage() {
  return (
    <>
      <Head>
        <title>About - My Blog</title>
      </Head>

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>About</h1>
        <p>This is a blog built with Veryfront, a modern React framework.</p>
        <Link href="/">← Back to Home</Link>
      </main>
    </>
  );
}
```

### Step 5: Add Dynamic Route with Data

**app/blog/page.tsx:**
```tsx
import { Head, Link } from 'veryfront';
import type { PageWithData, DataContext } from 'veryfront';

const posts = [
  { slug: 'hello-world', title: 'Hello World', date: '2024-01-01' },
  { slug: 'getting-started', title: 'Getting Started with Veryfront', date: '2024-01-15' },
  { slug: 'advanced-patterns', title: 'Advanced Patterns', date: '2024-02-01' },
];

export const getServerData = async (ctx: DataContext) => {
  return { props: { posts } };
};

const BlogListPage: PageWithData<{ posts: typeof posts }> = ({ posts }) => {
  return (
    <>
      <Head>
        <title>Blog Posts</title>
      </Head>

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>Blog Posts</h1>

        <ul style={{ listStyle: 'none', padding: 0 }}>
          {posts.map(post => (
            <li key={post.slug} style={{ marginBottom: '1rem' }}>
              <Link href={`/blog/${post.slug}`}>
                <h3 style={{ margin: 0 }}>{post.title}</h3>
              </Link>
              <small style={{ color: '#666' }}>{post.date}</small>
            </li>
          ))}
        </ul>

        <Link href="/">← Back to Home</Link>
      </main>
    </>
  );
};

export default BlogListPage;
```

**app/blog/[slug]/page.tsx:**
```tsx
import { Head, Link } from 'veryfront';
import type { PageWithData, DataContext } from 'veryfront';
import { notFound } from 'veryfront';

const posts: Record<string, { title: string; content: string; date: string }> = {
  'hello-world': {
    title: 'Hello World',
    content: 'Welcome to my first blog post! This is built with Veryfront.',
    date: '2024-01-01',
  },
  'getting-started': {
    title: 'Getting Started with Veryfront',
    content: 'Learn how to build modern React applications with Veryfront.',
    date: '2024-01-15',
  },
  'advanced-patterns': {
    title: 'Advanced Patterns',
    content: 'Explore advanced patterns in Veryfront development.',
    date: '2024-02-01',
  },
};

export const getServerData = async (ctx: DataContext) => {
  const post = posts[ctx.params.slug as keyof typeof posts];
  if (!post) return notFound();
  return { props: { post, slug: ctx.params.slug } };
};

const BlogPostPage: PageWithData<{
  post: { title: string; content: string; date: string };
  slug: string;
}> = ({ post, slug }) => {
  return (
    <>
      <Head>
        <title>{post.title} - My Blog</title>
      </Head>

      <article style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>{post.title}</h1>
        <time style={{ color: '#666' }}>{post.date}</time>

        <div style={{ marginTop: '2rem', lineHeight: '1.6' }}>
          {post.content}
        </div>

        <nav style={{ marginTop: '2rem' }}>
          <Link href="/blog">← Back to Blog</Link>
        </nav>
      </article>
    </>
  );
};

export default BlogPostPage;
```

### Step 6: Add API Route

**app/api/posts/route.ts:**
```typescript
import { json } from 'veryfront';
import type { APIHandler } from 'veryfront';

const posts = [
  { id: 1, title: 'Hello World', slug: 'hello-world' },
  { id: 2, title: 'Getting Started', slug: 'getting-started' },
  { id: 3, title: 'Advanced Patterns', slug: 'advanced-patterns' },
];

export const GET: APIHandler = async (ctx) => {
  return json({ posts, total: posts.length });
};

export const POST: APIHandler = async (ctx) => {
  const body = await ctx.request.json();
  const newPost = { id: posts.length + 1, ...body };
  posts.push(newPost);
  return json(newPost, { status: 201 });
};
```

### Step 7: Start Development Server

```bash
deno task dev
```

Visit **http://localhost:3000** and test:
- Home page at `/`
- About page at `/about`
- Blog list at `/blog`
- Individual posts at `/blog/hello-world`
- API at `/api/posts`

**What you built:**
- ✅ File-based routing
- ✅ Dynamic routes with parameters
- ✅ Type-safe data fetching
- ✅ API routes
- ✅ 404 handling

## Part 2: Add Agent Capabilities

Add conversational AI features to your blog.

### Step 1: Install Dependencies

```bash
deno add ai zod
```

### Step 2: Enable Agents

**veryfront.config.ts:**
```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  title: 'My Blog',
  runtime: 'deno',
  ai: {
    enabled: true,
    providers: {
      openai: {
        apiKey: getEnv('OPENAI_API_KEY'),
      },
    },
  },
});
```

### Step 3: Create a Tool

**ai/tools/search-posts.ts:**
```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

const posts = [
  { title: 'Hello World', slug: 'hello-world' },
  { title: 'Getting Started', slug: 'getting-started' },
  { title: 'Advanced Patterns', slug: 'advanced-patterns' },
];

export default tool({
  description: 'Search blog posts by keyword',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
  }),
  execute: async ({ query }) => {
    const results = posts.filter(post =>
      post.title.toLowerCase().includes(query.toLowerCase())
    );
    return { results, total: results.length };
  },
});
```

### Step 4: Create an Agent

**ai/agents/blog-assistant.ts:**
```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful blog assistant. Help users find and discover blog posts.',
  tools: {
    searchPosts: true, // Auto-discovered tool
  },
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
```

### Step 5: Create Chat Endpoint

**app/api/chat/route.ts:**
```typescript
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.blogAssistant.stream({ messages });
  return stream.toDataStreamResponse();
}
```

### Step 6: Add Chat UI

**app/chat/page.tsx:**
```tsx
'use client';

import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';
import { Head, Link } from 'veryfront';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <>
      <Head>
        <title>Chat - My Blog</title>
      </Head>

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>Blog Assistant</h1>
        <p>Ask me anything about the blog!</p>

        <div style={{ marginTop: '2rem', height: '600px' }}>
          <Chat {...chat} />
        </div>

        <Link href="/">← Back to Home</Link>
      </main>
    </>
  );
};
```

### Step 7: Update Home Page

Add a link to the chat page:

**app/page.tsx:**
```tsx
// ... existing imports

export default function HomePage() {
  return (
    <>
      {/* ... existing Head */}

      <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem' }}>
        <h1>Welcome to My Blog</h1>
        <p>A modern React blog built with Veryfront</p>

        <nav>
          <Link href="/about">About</Link>
          {' | '}
          <Link href="/blog">Blog Posts</Link>
          {' | '}
          <Link href="/chat">Chat Assistant</Link>
        </nav>
      </main>
    </>
  );
}
```

### Step 8: Test Agent Features

```bash
# Set API key
export OPENAI_API_KEY=sk-...

# Start server
deno task dev
```

Visit **http://localhost:3000/chat** and try:
- "Search for posts about getting started"
- "What blog posts are available?"
- "Tell me about the hello world post"

**What you added:**
- ✅ Auto-discovered tools
- ✅ Conversational agents
- ✅ Streaming chat interface
- ✅ Memory management

## Next Steps

### Learn Core Concepts

1. **[Routing System](/guides/routing/README.md)** - Master file-based routing (App Router and Pages Router)
2. **[Rendering Modes](/guides/rendering/README.md)** - Understand SSR, SSG, ISR, JIT, and RSC
3. **[AI Capabilities](/ai/README.md)** - Explore agents, tools, and MCP integration
4. **[Deployment](/guides/deployment/README.md)** - Deploy to production on any platform

### Deep Dive into Features

#### Routing
- [App Router](/guides/routing/app-router.md) - Modern routing with nested layouts
- [Pages Router](/guides/routing/pages-router.md) - Simple, straightforward routing
- [Dynamic Routes](/guides/routing/dynamic-routes.md) - URL parameters and catch-all routes
- [API Routes](/guides/routing/api-routes.md) - Build backend APIs

#### Rendering
- [SSR Guide](/guides/rendering/ssr.md) - Server-side rendering for dynamic content
- [SSG Guide](/guides/rendering/ssg.md) - Static site generation for performance
- [ISR Guide](/guides/rendering/isr.md) - Incremental static regeneration
- [JIT Guide](/guides/rendering/jit.md) - Just-in-time rendering for massive sites

#### Components
- [Link Component](/reference/components/link.md) - Client-side navigation
- [Head Component](/reference/components/head.md) - SEO and meta tags
- [Image Component](/reference/components/optimized-image.md) - Optimized images

#### Hooks
- [useRouter](/reference/hooks/use-router.md) - Programmatic navigation
- [useParams](/reference/hooks/use-params.md) - Access URL parameters
- [usePathname](/reference/hooks/use-pathname.md) - Get current path
- [useSearchParams](/reference/hooks/use-search-params.md) - Query string parameters

### AI and Agent Development

- [AI Overview](/ai/README.md) - Complete AI capabilities overview
- [Getting Started with AI](/ai/getting-started.md) - Build your first agent
- [AI Specification](/ai/specification.md) - Technical specification

### Testing and Performance

- [Testing Overview](/guides/testing/README.md) - Test your application
- [Unit Testing](/guides/testing/unit.md) - Component and function tests
- [E2E Testing](/guides/testing/e2e.md) - End-to-end testing
- [Performance](/guides/performance/README.md) - Optimization techniques
- [Caching Strategies](/guides/performance/caching.md) - Improve performance

## What You Learned

### Traditional Features
- ✅ File-based routing with App Router
- ✅ Dynamic routes with parameters `[slug]`
- ✅ Type-safe data fetching with `getServerData`
- ✅ API routes for backend logic
- ✅ 404 handling with `notFound()`
- ✅ SEO with `Head` component

### Agent Features
- ✅ Tool auto-discovery from `ai/tools/`
- ✅ Agent definition with tools and memory
- ✅ Streaming responses
- ✅ Production-ready chat UI

## Common Patterns

### Client-Side Navigation

```tsx
import { Link } from 'veryfront';

<Link href="/about">About</Link>
```

### Data Fetching

```tsx
export const getServerData = async (ctx: DataContext) => {
  const data = await fetchData(ctx.params.id);
  return { props: { data } };
};
```

### API Route

```tsx
export const GET: APIHandler = async (ctx) => {
  return json({ message: 'Hello' });
};
```

### Tool Creation

```tsx
export default tool({
  description: 'Do something',
  inputSchema: z.object({ param: z.string() }),
  execute: async ({ param }) => ({ result: param }),
});
```

## Troubleshooting

### Hot Reload Not Working

Ensure `--watch` flag is in dev task:
```json
{
  "tasks": {
    "dev": "deno run --allow-all --watch src/main.ts"
  }
}
```

### Type Errors

Check `jsxImportSource` in deno.json:
```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

### Agent Not Responding

1. Check API key: `echo $OPENAI_API_KEY`
2. Check agent config in veryfront.config.ts
3. Check browser console for errors

## Project Structure

Your final project structure:

```
my-blog/
├── app/
│   ├── page.tsx              # Home page
│   ├── about/
│   │   └── page.tsx          # About page
│   ├── blog/
│   │   ├── page.tsx          # Blog list
│   │   └── [slug]/
│   │       └── page.tsx      # Individual post
│   ├── chat/
│   │   └── page.tsx          # Chat interface
│   └── api/
│       ├── posts/
│       │   └── route.ts      # Posts API
│       └── chat/
│           └── route.ts      # Chat API
├── ai/
│   ├── tools/
│   │   └── search-posts.ts   # Search tool
│   └── agents/
│       └── blog-assistant.ts # Chat agent
├── deno.json                 # Deno config
└── veryfront.config.ts       # Veryfront config
```

---

**Congratulations!** You've built a full-stack React application with AI capabilities in 30 minutes. Continue exploring Veryfront's features in the [guides section](/guides/routing/README.md).
