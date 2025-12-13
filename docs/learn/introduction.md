# Introduction

Veryfront is a React framework for Deno with multi-runtime support, flexible rendering modes, and native AI agent capabilities.

## Features

### Multi-Runtime Support

Deploy the same codebase on Deno, Node.js, Bun, or Cloudflare Workers. Veryfront adapts to each runtime's capabilities automatically.

```typescript
import { startUniversalServer } from 'veryfront/server';

await startUniversalServer({
  projectDir: './',
  port: 3000,
});
```

### File-Based Routing

Routes are defined by the file system. No configuration required.

```
app/
├── page.tsx              → /
├── blog/[slug]/page.tsx  → /blog/:slug
└── api/posts/route.ts    → /api/posts
```

### AI Agent Discovery

Agents and tools are automatically discovered from the `ai/` directory.

```
ai/
├── tools/search.ts       → Tool "search"
├── agents/support.ts     → Agent "support"
└── resources/users/[id]/ → Resource /users/:id
```

### Multiple Rendering Modes

Choose the rendering strategy that fits each page.

| Mode | Description |
|------|-------------|
| SSR | Server-rendered on every request |
| SSG | Pre-rendered at build time |
| ISR | Static with periodic regeneration |
| JIT | Generated on first request, cached permanently |
| RSC | React Server Components (experimental) |

### Native TypeScript

On Deno, TypeScript runs natively without a build step. On Node.js and Bun, full type safety is preserved through compilation.

## When to Use Veryfront

**Good fit:**

- Deno-first projects
- Applications requiring multi-runtime deployment
- AI-powered applications with agents and tools
- Large-scale sites benefiting from JIT rendering
- Projects using Model Context Protocol (MCP)

**Consider alternatives if:**

- You need a mature ecosystem with extensive third-party plugins
- Enterprise support is required
- You prefer Svelte, Vue, or other non-React frameworks

## Architecture

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (pages/, app/, ai/, components/)       │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         Framework APIs                  │
│  Link, Head, getServerData, agent()     │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         Framework Core                  │
│  rendering, routing, ai, data, platform │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         Runtime Layer                   │
│  Deno / Node.js / Bun / CF Workers      │
└─────────────────────────────────────────┘
```

## Example

A page with server-side data fetching:

```tsx
// app/posts/[slug]/page.tsx
import { Head, Link } from 'veryfront';
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await db.posts.findBySlug(ctx.params.slug);
  if (!post) return { notFound: true };
  return { props: { post } };
};

const PostPage: PageWithData<{ post: Post }> = ({ post }) => {
  return (
    <>
      <Head>
        <title>{post.title}</title>
      </Head>
      <article>
        <h1>{post.title}</h1>
        <div>{post.content}</div>
      </article>
      <Link href="/posts">Back to posts</Link>
    </>
  );
};

export default PostPage;
```

An AI agent with tools:

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: {
    searchPosts: true,
    createDraft: true,
  },
});
```

## Project Status

Veryfront is in active development. Current version: 0.0.6

| Component | Status |
|-----------|--------|
| Core rendering (SSR, SSG, ISR) | Stable |
| Routing (App Router, Pages Router) | Stable |
| Data fetching | Stable |
| AI agent system | Stable |
| Platform: Deno | Stable |
| Platform: Node.js | Beta |
| Platform: Bun | Beta |
| Platform: Cloudflare Workers | Experimental |
| React Server Components | Experimental |

## Next Steps

- [Installation](./installation.md) - Set up Veryfront
- [Quick Start](./quickstart.md) - Build your first app
- [Project Structure](./project-structure.md) - Understand file organization
