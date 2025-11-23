# Introduction to Veryfront

**Veryfront** is a modern React framework for Deno with multi-runtime support, flexible rendering modes, and **native agent capabilities** — build traditional React applications or intelligent systems with built-in agents, tools, and Model Context Protocol integration.

## What is Veryfront?

Veryfront is a full-stack React framework that provides:

-  **Multiple Rendering Modes** - SSR, SSG, ISR, JIT, and RSC (experimental)
-  **Multi-Runtime Support** - Works on Deno, Node.js, Bun, and Cloudflare Workers
-  **Agent System** - Built-in autonomous agents with tools, memory, and multi-step reasoning
-  **File-Based Conventions** - Routing (`app/`, `pages/`) and agent discovery (`ai/tools/`, `ai/agents/`)
-  **Model Context Protocol** - Native MCP server with automatic tool/resource exposure
-  **TypeScript-First** - Native TypeScript support with Deno, full type safety throughout
-  **Zero-Config Development** - File-based routing and agent auto-discovery
-  **Production Features** - Rate limiting, caching, cost tracking, and security for both traditional and agent-based endpoints
-  **Flexible UI Architecture** - Headless hooks, unstyled primitives, or styled components
-  **Image Optimization** - Automatic WebP/AVIF conversion
-  **Zero-Config MDX** - Built-in MDX support with frontmatter

## Why Veryfront?

### 1. Deploy Anywhere

Write once, deploy to any runtime:

```typescript
// Same code works on Deno, Node.js, Bun, Cloudflare Workers
import { startUniversalServer } from 'veryfront/server';

await startUniversalServer({
  projectDir: './',
  port: 3000,
});
```

Veryfront adapts automatically to runtime capabilities, including agent workload optimization for edge deployments.

### 2. Convention-Driven Development

**File-based routing** for pages:

```
app/
├── page.tsx              → /
├── blog/[slug]/page.tsx  → /blog/:slug
└── api/posts/route.ts    → /api/posts
```

**File-based discovery** for agents and tools:

```
ai/
├── tools/search.ts       → Auto-registered tool "search"
├── agents/support.ts     → Auto-registered agent "support"
└── resources/users/[id]/ → Resource pattern /users/:id
```

Same philosophy, consistent experience.

### 3. Native Agent Capabilities

Create autonomous agents that use tools to solve problems:

```typescript
// ai/tools/get-weather.ts
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Get current weather for a city',
  inputSchema: z.object({
    city: z.string(),
  }),
  execute: async ({ city }) => {
    return await weatherAPI.get(city);
  },
});

// ai/agents/travel-assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You help people plan trips',
  tools: {
    getWeather: true,  // References auto-discovered tool
  },
  memory: { type: 'conversation', maxTokens: 4000 },
});
```

Agents integrate with the same routing and rendering system as traditional pages.

### 4. Flexible UI Architecture

Build interfaces that match your requirements:

**Production-ready components** for rapid development:

```tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

**Unstyled primitives** for design system integration:

```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';

<ChatContainer className="ds-container">
  <MessageList>
    {messages.map((msg) => (
      <MessageItem key={msg.id} className="ds-message">
        {msg.content}
      </MessageItem>
    ))}
  </MessageList>
</ChatContainer>
```

**Headless hooks** for complete control:

```tsx
import { useChat } from 'veryfront/ai/react';

const { messages, input, append } = useChat({ api: '/api/chat' });
// Build custom UI with full control over state and rendering
```

### 5. Model Context Protocol Integration

Expose tools and resources via MCP:

```bash
veryfront dev --mcp
```

Tools defined in `ai/tools/` are automatically available to external MCP clients (Claude Desktop, OpenAI, etc.). Resources in `ai/resources/` provide structured data access. Zero configuration required.

### 6. Multi-Agent Composition

Coordinate multiple specialized agents:

```typescript
import { createWorkflow } from 'veryfront/ai';

const contentPipeline = createWorkflow({
  steps: [
    { agent: researcher, name: 'research' },
    { agent: writer, name: 'draft' },
    { agent: editor, name: 'refine' },
  ],
});

const result = await contentPipeline.execute('Topic');
```

Or use agents as tools:

```typescript
import { agentAsTool } from 'veryfront/ai';

const orchestrator = agent({
  system: 'Coordinate specialized agents',
  tools: {
    research: agentAsTool(researcher, 'Research topics'),
    write: agentAsTool(writer, 'Write content'),
  },
});
```

### 7. Choose Your Rendering Mode

Pick the right strategy for each page:

| Mode | Use Case | Build Time | Request Time |
|------|----------|------------|--------------|
| **SSR** | Dynamic content, agent-generated pages | - | Real-time |
| **SSG** | Static pages, documentation | Pre-render | Instant |
| **ISR** | Occasionally updated content | Pre-render | Cached + regen |
| **JIT** | Large-scale sites (100k+ pages) | Critical pages | On-demand |
| **RSC** | Zero-JS pages (experimental) | - | Server components |

Works with both traditional data fetching and agent-generated content.

### 8. Production Features

Built-in features for production deployments:

**For agents**:
- Rate limiting (prevent abuse)
- Response caching (reduce costs)
- Cost tracking (budget management)
- Input validation (security)
- Output filtering (content safety)

**For traditional endpoints**:
- CORS configuration
- CSP headers
- Request middleware
- Response caching

Same infrastructure powers both.

## Quick Comparison

### vs Next.js

| Feature | Veryfront | Next.js |
|---------|-----------|---------|
| **Runtimes** | Deno, Node.js, Bun, CF Workers | Node.js only |
| **TypeScript** | Native (Deno) | Compilation required |
| **Agent System** | Built-in with auto-discovery | Use AI SDK separately |
| **MCP Server** | Native integration | Not available |
| **Tool Auto-Discovery** | File-based, zero-config | Manual registration |
| **Remote Rendering** | Built-in | Not supported |
| **JIT Rendering** | Unique feature | Not available |

### vs Remix

| Feature | Veryfront | Remix |
|---------|-----------|-------|
| **Runtimes** | Deno, Node.js, Bun, CF Workers | Node.js, CF Workers |
| **SSG** | Built-in | Not supported |
| **ISR** | Built-in | Not supported |
| **Agent Capabilities** | Built-in | Use libraries like LangChain |
| **Convention-Driven Agents** | File-based discovery | Manual setup |

## Core Features

### 1. File-Based Routing

Two routing modes to choose from:

**App Router** (Next.js 13+ style):
```
app/
├── page.tsx              → /
├── about/page.tsx        → /about
├── blog/
│   ├── page.tsx          → /blog
│   └── [slug]/page.tsx   → /blog/:slug
└── api/
    └── posts/route.ts    → /api/posts
```

**Pages Router** (Next.js 12 style):
```
pages/
├── index.tsx             → /
├── about.tsx             → /about
├── blog/
│   ├── index.tsx         → /blog
│   └── [slug].tsx        → /blog/:slug
└── api/
    └── posts.ts          → /api/posts
```

### 2. Agent Auto-Discovery

Parallel convention for agent components:

```
ai/
├── tools/
│   ├── search-web.ts     → Tool "searchWeb"
│   └── get-weather.ts    → Tool "getWeather"
├── agents/
│   ├── support.ts        → Agent "support"
│   └── analyst.ts        → Agent "analyst"
├── resources/
│   └── users/[userId]/
│       └── profile.ts    → Resource /users/:userId/profile
└── prompts/
    └── system.ts         → Prompt "system"
```

Tools and agents are discovered at startup, available via imports:

```typescript
import { agents } from '@/ai/agents';
import { tools } from '@/ai/tools';

const response = await agents.support.generate({ input: 'Help!' });
const result = await tools.searchWeb.execute({ query: 'info' });
```

### 3. Data Fetching

Type-safe data fetching for traditional content:

```typescript
import type { PageWithData, DataContext } from 'veryfront';

export const getServerData = async (ctx: DataContext) => {
  const post = await db.posts.findOne({ slug: ctx.params.slug });
  return { props: { post } };
}

const BlogPost: PageWithData<{ post: Post }> = ({ post }) => {
  return <article>{post.content}</article>;
}
```

Can be combined with agent-generated content:

```typescript
export const getServerData = async (ctx: DataContext) => {
  const [post, summary] = await Promise.all([
    db.posts.findOne({ slug: ctx.params.slug }),
    agents.summarizer.generate({ input: ctx.params.slug }),
  ]);

  return { props: { post, summary: summary.text } };
}
```

### 4. Built-in Components

**Traditional components**:
```typescript
import { Link, Head, OptimizedImage } from 'veryfront';
```

**Agent UI components**:
```typescript
import { Chat, AgentCard } from 'veryfront/ai/components';
import { useChat, useAgent } from 'veryfront/ai/react';
import { ChatContainer, MessageList } from 'veryfront/ai/primitives';
```

Consistent API design across traditional and agent features.

### 5. Memory Management

Three strategies for managing conversation history:

```typescript
// Keep full history
memory: { type: 'conversation', maxTokens: 4000 }

// Sliding window
memory: { type: 'buffer', maxMessages: 10 }

// Auto-summarize
memory: { type: 'summary', maxMessages: 20 }
```

Query memory statistics:

```typescript
const stats = await agent.getMemoryStats();
// { totalMessages: 15, estimatedTokens: 2340, type: 'conversation' }
```

### 6. Production Middleware

Stack middleware for both traditional and agent endpoints:

```typescript
const agent = agent({
  middleware: [
    rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }),
    cacheMiddleware({ strategy: 'ttl', ttl: 300000 }),
    costTrackingMiddleware({ pricing: {...}, limits: { daily: 10 } }),
    securityMiddleware({ input: { sanitize: true }, output: { filterPII: true } }),
  ],
});
```

Same middleware concepts as traditional Veryfront request pipeline.

## Architecture

Veryfront has a modular architecture with 16 modules:

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (pages/, app/, ai/, components/)       │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│         Public API Layer                │
│  • Framework: Link, Head, getServerData │
│  • Agents: agent(), tool(), useChat     │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│       Framework Core (16 Modules)       │
│                                         │
│  • rendering/  - SSR, SSG, ISR, JIT    │
│  • routing/    - File-based routing     │
│  • ai/         - Agent runtime, MCP     │
│  • data/       - Data fetching          │
│  • platform/   - Runtime adapters       │
│  • security/   - CORS, CSP, validation  │
│  • middleware/ - Request pipeline       │
│  • [9 more modules...]                  │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│         Runtime Layer                   │
│  Deno / Node.js / Bun / CF Workers     │
└─────────────────────────────────────────┘
```

The agent module integrates with existing framework infrastructure:
- Agent endpoints use the routing system
- Agent components use the rendering pipeline
- Agent responses can be cached via the data layer
- Agent requests pass through middleware

[→ See complete architecture](./advanced/architecture.md)

## Who Should Use Veryfront?

###  Great For:

- **Conversational Interfaces** - Production chat, customer support, interactive assistants
- **Multi-Agent Applications** - Coordinate specialized agents for complex workflows
- **MCP Implementations** - Expose tools and resources via Model Context Protocol
- **Intelligent Dashboards** - Combine traditional data with agent-generated insights
- **Deno Projects** - Native TypeScript support without compilation
- **Multi-Runtime Deployment** - Deploy to Deno, Node.js, Bun, or Cloudflare Workers
- **Large-Scale Sites** - JIT rendering for 100,000+ pages
- **Content-Heavy Applications** - Zero-config MDX with frontmatter

###  Consider Alternatives If:

- **Production stability critical** - Veryfront is pre-release (v0.1.0)
- **Large ecosystem needed** - Next.js has more plugins and integrations
- **Enterprise support required** - Next.js (Vercel) offers paid support
- **Svelte preferred** - Use SvelteKit instead

## Status

**Current Version:** 0.1.0 (pre-release)

**Stability:**
-  **Stable**: Core rendering, routing, data fetching
-  **Stable**: Agent module (runtime, MCP server, UI components, production features)
-  **Beta**: Platform adapters (Node.js, Bun, CF Workers)
-  **Experimental**: RSC (React Server Components)

**Production Ready?**
- **Deno**: Yes, for both traditional and agent-based applications
- **Other runtimes**: Test thoroughly before production
- **Agent features**: Production-ready with rate limiting, caching, and security

## Getting Started

Choose your path:

### Build with Agents

1. [**Agent Quick Start**](./ai/getting-started.md) - Create a chat application with agents
2. [**Agent Specification**](./ai/specification.md) - Complete agent system documentation
3. [**Agent Examples**](../examples/full-demo/README.md) - Working demonstrations

### Build Traditional Apps

4. [**Quick Start**](./quick-start.md) - Create a React application
5. [**Installation**](./installation.md) - Install for your runtime
6. [**Routing Guide**](./routing/README.md) - Learn file-based routing
7. [**Deployment**](./guides/deployment.md) - Deploy to production

## Key Capabilities

### Convention-Based Auto-Discovery

Both routing and agent systems use file-based conventions:

```
pages/blog/[slug].tsx     → Route /blog/:slug
ai/tools/search.ts        → Tool "search"
ai/agents/support.ts      → Agent "support"
```

No configuration files, no registration code. Drop files in the right directory.

### Agent Memory Strategies

Choose the appropriate memory strategy:

- **Conversation** - Keep full history (best for context-dependent conversations)
- **Buffer** - Keep last N messages (good for sliding window)
- **Summary** - Auto-summarize old messages (token efficient for long conversations)

### Three-Layer UI System

Choose the abstraction level you need:

- **Headless hooks** - Complete control (useChat, useAgent, useCompletion, useStreaming)
- **Unstyled primitives** - Radix UI-based components, bring your own styles
- **Styled components** - Production-ready with theme system and dark mode

### Model Context Protocol

MCP server exposes your tools and resources:

```bash
veryfront dev --mcp
```

Tools in `ai/tools/` are automatically available via MCP. Resources in `ai/resources/` provide data access patterns. Prompts in `ai/prompts/` offer templates.

### Multi-Agent Workflows

Compose agents for complex tasks:

```typescript
import { createWorkflow } from 'veryfront/ai';

const pipeline = createWorkflow({
  steps: [
    { agent: dataCollector, name: 'collect' },
    { agent: analyzer, name: 'analyze' },
    { agent: reporter, name: 'report' },
  ],
});

const result = await pipeline.execute(input);
```

### Production Middleware

Apply production features to agent endpoints:

```typescript
const agent = agent({
  model: 'openai/gpt-4',
  middleware: [
    rateLimitMiddleware({ maxRequests: 10, windowMs: 60000 }),
    cacheMiddleware({ strategy: 'ttl', ttl: 300000 }),
    costTrackingMiddleware({ limits: { daily: 10 } }),
    securityMiddleware({ input: { sanitize: true }, output: { filterPII: true } }),
  ],
});
```

Same middleware pattern as traditional Veryfront request handlers.

## Real-World Example

Customer support application combining traditional and agent features:

```typescript
// Traditional page rendering
// app/support/page.tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function SupportPage() {
  return (
    <div>
      <Header />
      <Chat {...useChat({ api: '/api/support' })} />
      <Footer />
    </div>
  );
}

// Agent endpoint
// app/api/support/route.ts
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.support.stream({ messages });
  return stream.toDataStreamResponse();
}

// Auto-discovered agent
// ai/agents/support.ts
export default agent({
  model: 'openai/gpt-4',
  system: 'You are a customer support agent',
  tools: {
    searchKB: true,      // Auto-discovered
    createTicket: true,  // Auto-discovered
  },
  memory: { type: 'conversation', maxTokens: 4000 },
  middleware: [
    rateLimitMiddleware({ maxRequests: 50, windowMs: 60000 }),
    cacheMiddleware({ strategy: 'ttl', ttl: 300000 }),
    securityMiddleware({ output: { filterPII: true } }),
  ],
});

// Auto-discovered tools
// ai/tools/search-kb.ts
export default tool({
  description: 'Search knowledge base',
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => await searchKnowledgeBase(query),
});

// ai/tools/create-ticket.ts
export default tool({
  description: 'Create support ticket',
  inputSchema: z.object({
    issue: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  execute: async ({ issue, priority }) => await createTicket(issue, priority),
});
```

Traditional framework features (routing, rendering, components) work seamlessly with agent capabilities.

## Community

- **GitHub**: [github.com/veryfront/veryfront](https://github.com/veryfront/veryfront)
- **Issues**: [Report bugs](https://github.com/veryfront/veryfront/issues)
- **Discussions**: [Ask questions](https://github.com/veryfront/veryfront/discussions)
- **Documentation**: [Complete guide](./ai/README.md)
- **Contributing**: [Contribution guide](./community/contributing.md)

## License

MIT License - see [LICENSE](../LICENSE) file.

---

**Next:**
- [Quick Start Guide](./quick-start.md) →
- [Agent Quick Start](./ai/getting-started.md) →
- [Complete Demo](../examples/full-demo/README.md) →
