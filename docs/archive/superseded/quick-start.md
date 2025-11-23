# Quick Start

Get up and running with Veryfront in less than 5 minutes.

**Choose your path:**
- [Traditional React App](#traditional-react-app) - Build a React application
- [With Agent Capabilities](#with-agent-capabilities) - Add conversational interfaces

## Prerequisites

Choose your runtime:

- **Deno 1.40+** (recommended) - [Install Deno](https://deno.land/)
- **Node.js 18+** - [Install Node.js](https://nodejs.org/)
- **Bun 1.0+** - [Install Bun](https://bun.sh/)

---

## Traditional React App

Build a standard React application with Veryfront.

### 1. Create Project

**With Deno (Recommended):**

```bash
mkdir my-app
cd my-app
deno init
deno add veryfront react react-dom
```

**With Node.js:**

```bash
mkdir my-app
cd my-app
npm init -y
npm install veryfront react react-dom
```

### 2. Configure

**veryfront.config.ts:**

```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  title: 'My Veryfront App',
  dev: {
    port: 3000,
    hmr: true,
  },
});
```

### 3. Create a Page

**pages/index.tsx:**

```typescript
import { Head, Link } from 'veryfront';

export default function Home() {
  return (
    <>
      <Head>
        <title>My Veryfront App</title>
      </Head>

      <main>
        <h1>Welcome to Veryfront</h1>
        <p>Modern React framework for Deno</p>
        <Link href="/about">About</Link>
      </main>
    </>
  );
}
```

### 4. Add Data Fetching

**pages/blog/[slug].tsx:**

```typescript
import { Head } from 'veryfront';
import type { PageWithData, DataContext } from 'veryfront';
import { notFound } from 'veryfront';

const posts = {
  'hello-world': {
    title: 'Hello World',
    content: 'My first post!',
  },
};

export const getServerData = async (ctx: DataContext) => {
  const post = posts[ctx.params.slug as keyof typeof posts];
  if (!post) return notFound();
  return { props: { post } };
};

const BlogPost: PageWithData<{ post: typeof posts['hello-world'] }> = ({ post }) => {
  return (
    <>
      <Head>
        <title>{post.title}</title>
      </Head>
      <article>
        <h1>{post.title}</h1>
        <p>{post.content}</p>
      </article>
    </>
  );
};

export default BlogPost;
```

### 5. Create API Route

**pages/api/hello.ts:**

```typescript
import { json } from 'veryfront';
import type { APIHandler } from 'veryfront';

export const GET: APIHandler = async (ctx) => {
  return json({
    message: 'Hello from Veryfront!',
    timestamp: new Date().toISOString(),
  });
};
```

### 6. Start Development Server

```bash
# Deno
deno task dev

# Node.js
npm run dev

# Bun
bun dev
```

Visit **http://localhost:3000**

---

## With Agent Capabilities

Add conversational interfaces to your application.

### 1. Install Dependencies

```bash
npm install ai zod
```

### 2. Enable Agents

**veryfront.config.ts:**

```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  ai: {
    enabled: true,
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
    },
  },
});
```

### 3. Create a Tool

**ai/tools/get-time.ts:**

```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Get current time',
  inputSchema: z.object({}),
  execute: async () => ({
    time: new Date().toLocaleTimeString(),
  }),
});
```

Files in `ai/tools/` are automatically discovered and registered.

### 4. Create an Agent

**ai/agents/assistant.ts:**

```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant',
  tools: {
    getTime: true,  // References auto-discovered tool
  },
  memory: { type: 'conversation', maxTokens: 4000 },
});
```

Files in `ai/agents/` are automatically discovered and available via imports.

### 5. Create Agent Endpoint

**app/api/chat/route.ts:**

```typescript
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.assistant.stream({ messages });
  return stream.toDataStreamResponse();
}
```

### 6. Add Chat UI

**app/chat/page.tsx:**

```tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

Or use headless hooks for custom UI:

```tsx
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const { messages, input, setInput, append } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      <div>
        {messages.map((msg) => (
          <div key={msg.id}>
            <strong>{msg.role}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => {
        e.preventDefault();
        append({ role: 'user', content: input });
        setInput('');
      }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

### 7. Start with MCP Server (Optional)

Expose your tools via Model Context Protocol:

```bash
export OPENAI_API_KEY=sk-...
veryfront dev --mcp
```

Tools in `ai/tools/` are now available to external MCP clients.

---

## Next Steps

### Traditional Development
- [Routing Guide](./routing/README.md) - Learn App Router and Pages Router
- [Rendering Modes](./rendering/README.md) - SSR, SSG, ISR, JIT
- [Data Fetching](./data-fetching/README.md) - Server data and caching
- [Deployment](./guides/deployment.md) - Deploy to production

### Agent Development
- [Agent Guide](./ai/getting-started.md) - Complete agent documentation
- [Agent Specification](./ai/specification.md) - Technical reference
- [Examples](../examples/full-demo/README.md) - Working demonstrations

---

## What You Built

**Traditional App:**
- File-based routing
- Type-safe data fetching
- API routes
- React components

**With Agents:**
- Auto-discovered tools
- Autonomous agents with memory
- Streaming chat interface
- MCP server (optional)

Both use the same framework infrastructure - routing, rendering, middleware, and security.
