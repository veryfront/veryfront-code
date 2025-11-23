---
title: What is Veryfront?
description: Introduction to Veryfront - a modern React framework with multi-runtime support and native agent capabilities
category: learn
level: beginner
keywords:
  - introduction
  - overview
  - features
  - react framework
reading_time: 5 min
next_page: /learn/installation.md
---

# What is Veryfront?

**Veryfront** is a modern React framework for Deno with multi-runtime support, flexible rendering modes, and native agent capabilities. Build traditional React applications or intelligent systems with built-in agents, tools, and Model Context Protocol integration.

## Core Philosophy

Veryfront is built on three principles:

1. **Convention over Configuration** - File-based routing and agent auto-discovery
2. **Deploy Anywhere** - One codebase runs on Deno, Node.js, Bun, and Cloudflare Workers
3. **Progressive Enhancement** - Start simple, add complexity when needed

## Key Features

### Multi-Runtime Support

Write once, deploy anywhere:

```typescript
// Same code works on Deno, Node.js, Bun, Cloudflare Workers
import { startUniversalServer } from 'veryfront/server';

await startUniversalServer({
  projectDir: './',
  port: 3000,
});
```

Veryfront adapts automatically to runtime capabilities.

### File-Based Conventions

**Routing:**
```
app/
├── page.tsx              → /
├── blog/[slug]/page.tsx  → /blog/:slug
└── api/posts/route.ts    → /api/posts
```

**Agent Discovery:**
```
ai/
├── tools/search.ts       → Auto-registered tool "search"
├── agents/support.ts     → Auto-registered agent "support"
└── resources/users/[id]/ → Resource pattern /users/:id
```

No configuration files, no registration code.

### Multiple Rendering Modes

Choose the right strategy for each page:

| Mode | Use Case | When to Use |
|------|----------|-------------|
| **SSR** | Dynamic content | Real-time data, personalization |
| **SSG** | Static pages | Documentation, blogs |
| **ISR** | Occasionally updated | Product pages, news |
| **JIT** | Large-scale sites | 100k+ pages |
| **RSC** | Zero-JS pages (experimental) | Content-heavy pages |

### Native Agent Capabilities

Create autonomous agents that use tools:

```typescript
// ai/tools/get-weather.ts
export default tool({
  description: 'Get current weather for a city',
  inputSchema: z.object({ city: z.string() }),
  execute: async ({ city }) => await weatherAPI.get(city),
});

// ai/agents/travel-assistant.ts
export default agent({
  model: 'openai/gpt-4',
  system: 'You help people plan trips',
  tools: { getWeather: true }, // Auto-discovered
  memory: { type: 'conversation', maxTokens: 4000 },
});
```

### TypeScript-First

- **Deno:** Native TypeScript, no build step
- **Node.js/Bun:** Full type safety with compilation
- **Type inference:** End-to-end type safety

### Production Features

Built-in for production:

- Rate limiting (prevent abuse)
- Response caching (reduce costs)
- Cost tracking (budget management)
- Input validation (security)
- CORS configuration
- CSP headers

## Why Veryfront?

### vs Next.js

| Feature | Veryfront | Next.js |
|---------|-----------|---------|
| **Runtimes** | Deno, Node.js, Bun, CF Workers | Node.js only |
| **TypeScript** | Native (Deno) | Compilation required |
| **Agent System** | Built-in | Use AI SDK separately |
| **MCP Server** | Native | Not available |
| **JIT Rendering** | Built-in | Not available |

### vs Remix

| Feature | Veryfront | Remix |
|---------|-----------|-------|
| **Runtimes** | Deno, Node.js, Bun, CF Workers | Node.js, CF Workers |
| **SSG** | Built-in | Not supported |
| **ISR** | Built-in | Not supported |
| **Agents** | Built-in | Use libraries |

## What Can You Build?

### Traditional Applications

- **Content Sites** - Blogs, documentation, marketing
- **Web Apps** - Dashboards, admin panels, SaaS
- **E-commerce** - Product pages, checkout flows
- **APIs** - REST, GraphQL, webhooks

### Agent-Powered Applications

- **Conversational Interfaces** - Chat, customer support
- **Multi-Agent Systems** - Specialized agents working together
- **MCP Implementations** - Tool/resource exposure
- **Intelligent Dashboards** - Data + AI insights

## Architecture Overview

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
│  • [11 more modules...]                 │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│         Runtime Layer                   │
│  Deno / Node.js / Bun / CF Workers     │
└─────────────────────────────────────────┘
```

## Who Should Use Veryfront?

### Great For

- **Deno enthusiasts** - Native TypeScript support
- **Multi-runtime projects** - Deploy flexibility
- **AI-powered apps** - Built-in agent system
- **Large-scale sites** - JIT rendering for 100k+ pages
- **MCP implementations** - Native protocol support

### Consider Alternatives If

- **Production stability critical** - Veryfront is v0.1.0 (pre-release)
- **Large ecosystem needed** - Next.js has more plugins
- **Enterprise support required** - Next.js offers paid support
- **Svelte preferred** - Use SvelteKit instead

## Project Status

**Current Version:** 0.1.0 (pre-release)

**Stability:**
- ✅ **Stable:** Core rendering, routing, data fetching, agent system
- 🔶 **Beta:** Platform adapters (Node.js, Bun, CF Workers)
- 🧪 **Experimental:** RSC (React Server Components)

**Production Ready:**
- **Deno:** Yes, for both traditional and agent-based apps
- **Other runtimes:** Test thoroughly before production
- **Agent features:** Production-ready with rate limiting, caching, security

## Example: Real-World Application

Customer support app combining traditional and agent features:

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
  ],
});
```

## Next Steps

Ready to start building?

1. **[Installation](/learn/installation.md)** - Set up Veryfront (2-10 minutes)
2. **[Quick Start](/learn/quickstart.md)** - Build your first app (30 minutes)
3. **[Routing Guide](/guides/routing/README.md)** - Learn file-based routing
4. **[Deployment](/guides/deployment/deno.md)** - Go to production

## Related Documentation

### Core Concepts
- [Routing System](/guides/routing/README.md) - File-based routing with App and Pages Router
- [Rendering Modes](/guides/rendering/README.md) - SSR, SSG, ISR, JIT, and RSC
- [AI Capabilities](/guides/ai/README.md) - Built-in agents, tools, and MCP

### Configuration
- [Configuration Reference](/reference/configuration/README.md) - Complete config options
- [CLI Reference](/reference/cli/README.md) - Command-line interface
- [File Conventions](/reference/file-conventions/README.md) - Special files and naming

### Deployment
- [Deno Deployment](/guides/deployment/deno.md) - Deploy to Deno Deploy
- [Node.js Deployment](/guides/deployment/node.md) - Deploy to Node.js platforms
- [Platform Adapters](/guides/adapters/README.md) - Multi-runtime support

---

**Questions?** Check the [troubleshooting guide](/guides/troubleshooting/README.md) or [join discussions](https://github.com/veryfront/veryfront/discussions).
