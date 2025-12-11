# Veryfront AI Native App Framework Specification

**Version:** 1.0.0
**Status:** ✅ **IMPLEMENTED - 100% COMPLETE**
**Date:** 2025-11-11
**Implementation**: See `implementation-status.md` and `getting-started.md`

---

## 🎉 Implementation Status: COMPLETE!

**All 8 Phases Implemented** (See `implementation-status.md` for details)

- ✅ Phase 1: Foundation (Core AI module, multi-runtime)
- ✅ Phase 2: MCP Integration (Auto-discovery, MCP server)
- ✅ Phase 3: Agent Enhancements (Memory, composition, workflows)
- ✅ Phase 4: Headless Hooks (Layer 1 - useChat, useAgent, useCompletion, useStreaming)
- ✅ Phase 5: Unstyled Primitives (Layer 2 - 12 Radix UI components)
- ✅ Phase 6: Styled Components (Layer 3 - Production-ready UI)
- ✅ Phase 7: Developer Experience (Testing, debugging, inspection)
- ✅ Phase 8: Production Features (Rate limiting, caching, cost tracking, security)

**Files Created**: 57 files (~5,000 lines)
**Examples**: 5 working demos
**Documentation**: Complete

**Quick Start**: See `getting-started.md`

---

## Table of Contents

1. [Overview](#overview)
2. [Goals & Principles](#goals--principles)
3. [Architecture](#architecture)
4. [Platform Compatibility](#platform-compatibility)
5. [Directory Structure & Conventions](#directory-structure--conventions)
6. [MCP Server Integration](#mcp-server-integration)
7. [Agent System](#agent-system)
8. [AI UI Components](#ai-ui-components)
9. [Configuration](#configuration)
10. [API Reference](#api-reference)
11. [Examples](#examples)
12. [Migration Guide](#migration-guide)
13. [Implementation Roadmap](#implementation-roadmap)

---

## Overview

This specification defines how Veryfront transforms into an **AI Native App Framework** — a comprehensive platform for building production-ready AI applications with convention-driven development, seamless MCP integration, and first-class agent support.

### What Makes It "AI Native"?

- **MCP-First**: Built-in Model Context Protocol support for connecting AI models to tools, data sources, and external systems
- **Agent Primitives**: First-class abstractions for building autonomous agents with tools, memory, and multi-step reasoning
- **AI UI Components**: Production-ready React components for chat interfaces, agent visualizations, and interactive AI experiences
- **Convention over Configuration**: File-system based auto-discovery for tools, agents, prompts, and resources
- **Multi-Runtime**: Works across Deno, Node.js, Bun, and Cloudflare Workers with edge-optimized agent execution

### Core Value Propositions

1. **Zero Boilerplate**: Drop files in the right directory and they're automatically discovered and registered
2. **Type-Safe**: End-to-end TypeScript support from backend tools to frontend UI
3. **Headless-First**: Three-layer architecture (hooks → primitives → styled components) serves all customization needs
4. **Production Ready**: Built on Veryfront's proven SSR/SSG/ISR infrastructure
5. **Composable**: Mix AI features with traditional web app patterns seamlessly
6. **Portable**: Deploy anywhere Veryfront runs — from edge to serverless to traditional servers

---

## Goals & Principles

### Primary Goals

1. **Simplify AI App Development**: Reduce the complexity of building AI-powered applications from weeks to hours
2. **Maintain Veryfront's Core Strengths**: Preserve existing rendering modes, routing, and multi-runtime support
3. **Adopt Industry Standards**: Embrace MCP and AI SDK patterns that are gaining industry adoption
4. **Enable Rapid Prototyping**: Allow developers to go from idea to working prototype in minutes
5. **Scale to Production**: Provide patterns that work for both prototypes and production applications

### Design Principles

1. **Convention Over Configuration**: Prefer file-system conventions over explicit configuration
2. **Progressive Enhancement**: AI features are opt-in; traditional Veryfront apps continue to work
3. **Type Safety**: Leverage TypeScript for compile-time safety across the entire stack
4. **Composability**: AI primitives should compose naturally with existing Veryfront features
5. **Runtime Agnostic**: AI features work across all supported runtimes with appropriate optimizations
6. **Developer Experience**: Optimize for clarity, discoverability, and rapid iteration

---

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Veryfront Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Frontend   │  │   Backend    │  │   AI Layer   │      │
│  │              │  │              │  │              │      │
│  │  • Pages     │  │  • API       │  │  • Agents    │      │
│  │  • AI UI     │  │  • SSR       │  │  • Tools     │      │
│  │  • Chat      │  │  • Middleware│  │  • MCP       │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                 │                  │               │
│         └─────────────────┴──────────────────┘               │
│                           │                                   │
├───────────────────────────┼───────────────────────────────────┤
│      Veryfront Core (15 Modules)                             │
│                                                               │
│  • Rendering (SSR/SSG/ISR/JIT/RSC)                          │
│  • Routing (App/Pages Router)                                │
│  • Data Fetching                                             │
│  • Platform Abstraction (Deno/Node/Bun/CF Workers)         │
└───────────────────────────┬───────────────────────────────────┘
                            │
┌───────────────────────────┼───────────────────────────────────┐
│        New AI Module      │                                   │
├───────────────────────────┴───────────────────────────────────┤
│                                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │ Agent Runtime  │  │  MCP Registry  │  │  AI Components │ │
│  ├────────────────┤  ├────────────────┤  ├────────────────┤ │
│  │ • Execution    │  │ • Tools        │  │ • Message      │ │
│  │ • Loop Control │  │ • Prompts      │  │ • Chat         │ │
│  │ • Memory       │  │ • Resources    │  │ • Agent UI     │ │
│  │ • Streaming    │  │ • Auto-        │  │ • Workflow     │ │
│  │ • Tool Call    │  │   Discovery    │  │   Canvas       │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │             Provider Integration Layer                 │  │
│  ├────────────────────────────────────────────────────────┤  │
│  │  • OpenAI  • Anthropic  • Google  • Local Models     │  │
│  │  • Unified API via AI SDK                             │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Module Structure

The AI functionality is added as a new **16th module** to Veryfront:

```
src/
├── ai/                    # New AI module
│   ├── index.ts          # Public API
│   ├── agent/            # Agent runtime
│   ├── mcp/              # MCP registry & discovery
│   ├── components/       # AI UI components
│   ├── providers/        # LLM provider integrations
│   └── utils/            # Shared utilities
└── [existing 15 modules]
```

This module integrates with existing Veryfront modules:
- **Routing**: AI endpoints are regular API routes
- **Rendering**: AI components work with SSR/SSG
- **Data**: Agent results can be cached and revalidated
- **Middleware**: AI requests pass through the middleware pipeline
- **Platform**: AI features adapt to runtime capabilities

---

## Platform Compatibility

### Overview

Veryfront AI is designed to work across **Deno, Node.js, Bun, and Cloudflare Workers**, but each platform has different capabilities and constraints. Understanding these differences is critical for production deployments.

### Compatibility Matrix

| Feature | Deno | Node.js | Bun | Cloudflare Workers |
|---------|------|---------|-----|-------------------|
| **Headless Hooks (Layer 1)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Primitives (Layer 2)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Styled Components (Layer 3)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **SSR/SSG** | ✅ Full | ✅ Full | ✅ Full | ⚠️ Limited |
| **Simple Agents (1-3 steps)** | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| **Complex Agents (10+ steps)** | ✅ Full | ✅ Full | ✅ Full | ❌ Timeout |
| **Agent Streaming** | ✅ Full | ✅ Full | ✅ Full | ✅ Required |
| **MCP Server** | ✅ Full | ✅ Full | ✅ Full | ❌ No |
| **File System Tools** | ✅ Full | ✅ Full | ✅ Full | ❌ No |
| **Long-running Tasks** | ✅ Full | ✅ Full | ✅ Full | ❌ 30s limit |
| **Memory Limits** | ✅ GB+ | ✅ GB+ | ✅ GB+ | ⚠️ 128MB |

### Platform Details

#### Deno (Recommended for AI Apps)

**Strengths:**
- Native TypeScript support
- Secure by default (permissions model)
- Built-in Web APIs
- Excellent for AI workloads
- Works with Deno Deploy (edge)

**Best for:** Full-featured AI applications, MCP servers, complex agents

```typescript
// veryfront.config.ts
export default {
  runtime: 'deno',
  ai: {
    mcp: { enabled: true },
    agents: {
      maxSteps: 20,  // No limits
    },
  },
};
```

#### Node.js

**Strengths:**
- Largest ecosystem
- Well-tested for production
- Full agent support
- Mature tooling

**Best for:** Enterprise applications, existing Node.js infrastructure

```typescript
// veryfront.config.ts
export default {
  runtime: 'node',
  ai: {
    mcp: { enabled: true },
    agents: {
      maxSteps: 20,
    },
  },
};
```

#### Bun

**Strengths:**
- Fastest JavaScript runtime
- Great for AI workloads
- Native TypeScript
- Node.js compatibility

**Best for:** Performance-critical AI applications

```typescript
// veryfront.config.ts
export default {
  runtime: 'bun',
  ai: {
    mcp: { enabled: true },
    agents: {
      maxSteps: 20,
    },
  },
};
```

#### Cloudflare Workers (Edge)

**Constraints:**
- ❌ CPU time limit: ~30 seconds
- ❌ Memory limit: 128MB
- ❌ No TCP servers (no MCP server)
- ❌ No file system access
- ❌ Stateless only

**Strengths:**
- ✅ Global distribution (low latency)
- ✅ Excellent for simple agents
- ✅ Great for streaming
- ✅ Cost-effective at scale

**Best for:** Global chat interfaces, simple customer support, FAQ bots

```typescript
// veryfront.config.ts
export default {
  runtime: 'cloudflare-workers',
  ai: {
    // Automatic edge optimizations
    edge: {
      enabled: true,
      maxAgentSteps: 3,
      streamingOnly: true,
    },
    mcp: {
      enabled: false,  // Can't run MCP server on workers
    },
    agents: {
      defaultMaxSteps: 3,
      defaultStreaming: true,
    },
  },
};
```

### Edge-Optimized Agent Pattern

For Cloudflare Workers and edge deployments:

```typescript
// ai/agents/edge-support.ts
import { agent } from 'veryfront/ai';

export default agent({
  id: 'edgeSupport',
  model: 'gpt-4',
  system: 'You are a helpful support agent',

  // Edge-specific configuration
  edge: {
    enabled: true,
    maxSteps: 3,           // Stay under CPU time limit
    timeoutMs: 25000,      // 25s (buffer before 30s limit)
    streaming: true,       // Required for responsive UX
  },

  // Only fast, stateless tools
  tools: {
    searchFAQ: true,       // ✅ Fast database lookup
    getArticle: true,      // ✅ KV store access
    // ❌ NO: Heavy computation, file I/O, long API calls
  },

  // Memory configuration for edge
  memory: {
    type: 'buffer',        // Lightweight memory
    maxTokens: 1000,       // Keep memory small
  },
});
```

### Platform Detection

Veryfront automatically detects the runtime and applies appropriate optimizations:

```typescript
// Automatic detection
import { detectPlatform } from 'veryfront/platform';

const platform = detectPlatform();
// Returns: 'deno' | 'node' | 'bun' | 'cloudflare-workers'

if (platform === 'cloudflare-workers') {
  // Apply edge optimizations automatically
  // - Limit agent steps
  // - Enable streaming by default
  // - Disable MCP server
  // - Use lightweight memory
}
```

### Deployment Recommendations

#### Full-Featured AI Apps
**Platform:** Deno, Node.js, or Bun
**Deploy to:** Deno Deploy, Vercel, Railway, Fly.io, AWS

```bash
# Deploy to Deno Deploy
deno deploy --project=my-ai-app main.ts

# Deploy to Vercel
vercel deploy
```

#### Global Edge Chat
**Platform:** Cloudflare Workers (edge agents) + Deno (MCP server)
**Architecture:**
```
[Cloudflare Workers]  →  [Simple edge agents]
       ↓
[Deno Deploy]        →  [MCP server + complex agents]
```

```typescript
// On CF Workers: Fast response
export default agent({
  model: 'gpt-4',
  maxSteps: 3,
  tools: { searchFAQ: true },
});

// On Deno: Complex tasks
export default agent({
  model: 'gpt-4',
  maxSteps: 20,
  tools: {
    deepAnalysis: true,
    fileProcessing: true,
  },
});
```

### Runtime-Specific Features

#### Deno-Specific

```typescript
// Use Deno KV for caching
import { openKv } from '@deno/kv';

export default tool({
  id: 'cacheResult',
  execute: async (input) => {
    const kv = await openKv();
    await kv.set(['cache', input.key], input.value);
  },
});
```

#### Cloudflare Workers-Specific

```typescript
// Use CF KV for fast lookups
export default tool({
  id: 'getFAQ',
  execute: async (input, env) => {
    const value = await env.FAQ_KV.get(input.question);
    return value;
  },
});
```

### Testing Across Platforms

```bash
# Test on Deno
deno task dev

# Test on Node
npm run dev

# Test on Bun
bun run dev

# Test on Cloudflare Workers (local)
wrangler dev

# Test edge optimizations
VERYFRONT_PLATFORM=cloudflare-workers npm run dev
```

### Migration Between Platforms

Moving between platforms is straightforward:

```typescript
// Before (Deno)
export default {
  runtime: 'deno',
  ai: { agents: { maxSteps: 20 } },
};

// After (Cloudflare Workers)
export default {
  runtime: 'cloudflare-workers',
  ai: {
    edge: { enabled: true },
    agents: { maxSteps: 3 },  // Automatically limited
  },
};
```

### Performance Characteristics

| Metric | Deno/Node/Bun | Cloudflare Workers |
|--------|---------------|-------------------|
| **Cold start** | 100-500ms | 0-10ms |
| **Agent execution (3 steps)** | 2-5s | 2-5s |
| **Agent execution (20 steps)** | 10-30s | ❌ Timeout |
| **Global latency** | 100-300ms | 10-50ms |
| **Cost (1M requests)** | $10-50 | $0.50-5 |

### Key Takeaways

1. **Layer 1-3 work everywhere** - UI components are platform-agnostic
2. **Simple agents work everywhere** - 1-3 step agents are edge-compatible
3. **Complex agents need servers** - Use Deno/Node/Bun for multi-step reasoning
4. **MCP requires servers** - Can't run on Cloudflare Workers
5. **Hybrid is powerful** - CF Workers (UI) + Deno (agents) = best of both worlds

---

## Directory Structure & Conventions

### Application Structure

A Veryfront AI Native application follows this structure:

```
my-ai-app/
├── veryfront.config.ts        # Veryfront + AI config
├── tsconfig.json
├── package.json
│
├── app/                        # App Router (recommended)
│   ├── layout.tsx
│   ├── page.tsx
│   │
│   ├── api/
│   │   ├── chat/
│   │   │   └── route.ts       # Chat endpoint using agents
│   │   └── workflow/
│   │       └── route.ts       # Workflow endpoint
│   │
│   ├── chat/
│   │   └── page.tsx           # Chat UI page
│   │
│   └── dashboard/
│       └── page.tsx           # Dashboard with AI widgets
│
├── ai/                         # AI configuration (auto-discovered)
│   ├── agents/                 # Agent definitions
│   │   ├── support-agent.ts   # Customer support agent
│   │   ├── analyst-agent.ts   # Data analyst agent
│   │   └── writer-agent.ts    # Content writer agent
│   │
│   ├── tools/                  # Tool implementations
│   │   ├── search.ts          # Web search tool
│   │   ├── database.ts        # Database query tool
│   │   ├── send-email.ts      # Email sending tool
│   │   └── fetch-user.ts      # User data fetcher
│   │
│   ├── prompts/                # System prompt templates
│   │   ├── support.ts         # Support prompt
│   │   ├── analyst.ts         # Analyst prompt
│   │   └── writer.ts          # Writer prompt
│   │
│   ├── resources/              # Data resources (MCP)
│   │   ├── users/
│   │   │   └── [userId]/
│   │   │       ├── profile.ts # User profile resource
│   │   │       └── history.ts # User history resource
│   │   └── products/
│   │       └── [productId].ts # Product resource
│   │
│   └── middleware.ts           # AI request middleware
│
├── components/
│   ├── ui/                     # (Optional) shadcn/ui components
│   │   ├── button.tsx
│   │   └── card.tsx
│   │
│   ├── ai/                     # (Optional) AI components
│   │   # • shadcn mode: Created via 'npx veryfront add chat'
│   │   # • Library mode ejection: Created via 'veryfront eject chat'
│   │   # • Default: Import from 'veryfront/ai/components' (no files here)
│   │   └── chat.tsx
│   │
│   └── custom/                 # Your custom components
│       └── feature-card.tsx
│
├── lib/
│   ├── agents.ts              # Agent utilities
│   └── tools.ts               # Tool utilities
│
└── public/
    └── assets/
```

### Auto-Discovery Rules

Files placed in specific directories are **automatically discovered and registered**:

| Directory | Purpose | Export Required | Auto-Registered As |
|-----------|---------|-----------------|-------------------|
| `ai/agents/` | Agent definitions | `default export Agent` | Named agent (filename) |
| `ai/tools/` | Tool implementations | `default export tool()` | Tool with filename as ID |
| `ai/prompts/` | System prompts | `default export string \| fn` | Prompt template |
| `ai/resources/` | MCP resources | `default export resource()` | Resource with path pattern |
| `ai/middleware.ts` | AI middleware | `export default middleware` | Global AI middleware |

**Example**: Dropping `ai/tools/search-web.ts` with a default export automatically registers a tool named `searchWeb` (camelCase).

---

## MCP Server Integration

### Overview

Veryfront provides a **built-in MCP (Model Context Protocol) server** that exposes your tools, prompts, and resources to AI models. This enables:

- External AI applications to use your tools
- Your agents to access MCP-compatible resources
- Standardized tool/resource discovery
- Cross-application AI interoperability

### MCP Server Architecture

```
┌─────────────────────────────────────────────────────────┐
│              External AI Clients                         │
│         (Claude Desktop, OpenAI, etc.)                  │
└───────────────────┬─────────────────────────────────────┘
                    │ MCP Protocol (JSON-RPC)
                    ↓
┌─────────────────────────────────────────────────────────┐
│           Veryfront MCP Server Adapter                   │
├─────────────────────────────────────────────────────────┤
│  • Protocol translation (MCP ↔ Veryfront)               │
│  • Tool/resource discovery                               │
│  • Request routing                                       │
│  • Authentication & authorization                        │
└───────────────────┬─────────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────────┐
│              MCP Registry                                │
├─────────────────────────────────────────────────────────┤
│  • Auto-discovered tools from ai/tools/                 │
│  • Auto-discovered resources from ai/resources/         │
│  • Auto-discovered prompts from ai/prompts/             │
│  • Runtime validation & schema generation               │
└─────────────────────────────────────────────────────────┘
```

### Tool Definition

Tools are defined using a standard API similar to AI SDK:

```typescript
// ai/tools/search-web.ts
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  id: 'searchWeb', // Optional, inferred from filename
  description: 'Search the web for information',

  inputSchema: z.object({
    query: z.string().describe('The search query'),
    maxResults: z.number().default(10),
  }),

  execute: async ({ query, maxResults }) => {
    const results = await fetch(`https://api.search.com?q=${query}`);
    return results.json();
  },

  // Optional: Control MCP exposure
  mcp: {
    enabled: true, // Expose via MCP (default: true)
    requiresAuth: true, // Require authentication
  },
});
```

### Resource Definition

Resources expose data to AI models using MCP:

```typescript
// ai/resources/users/[userId]/profile.ts
import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  // Path pattern (inferred from file location)
  pattern: '/users/:userId/profile',

  description: 'Get user profile information',

  paramsSchema: z.object({
    userId: z.string(),
  }),

  async load({ userId }) {
    const user = await db.users.findUnique({ where: { id: userId } });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      // ... other profile data
    };
  },

  // Optional: Subscribe to updates
  subscribe({ userId }) {
    return db.users.subscribe(userId);
  },
});
```

### Prompt Templates

Reusable system prompts for agents:

```typescript
// ai/prompts/customer-support.ts
import { prompt } from 'veryfront/ai';

export default prompt({
  id: 'customerSupport',
  description: 'Customer support agent prompt',

  // Static prompt
  content: `You are a helpful customer support agent.
Your goal is to assist customers with their issues efficiently and politely.

Available information:
- Customer name: {customerName}
- Issue type: {issueType}

Please follow these guidelines:
1. Always be polite and professional
2. Ask clarifying questions if needed
3. Provide step-by-step solutions
4. Escalate to human if necessary`,

  // Or dynamic prompt
  generate: ({ customerName, issueType, history }) => {
    return `You are assisting ${customerName} with a ${issueType} issue...`;
  },
});
```

### Starting the MCP Server

The MCP server can be started in development or production:

```bash
# Development mode (with hot reload)
veryfront dev --mcp

# Production mode
veryfront start --mcp

# Standalone MCP server (no HTTP server)
veryfront mcp
```

Configuration in `veryfront.config.ts`:

```typescript
export default {
  ai: {
    mcp: {
      enabled: true,
      port: 3001, // Default MCP port
      auth: {
        type: 'bearer', // 'bearer' | 'api-key' | 'none'
        validate: async (token) => {
          // Custom auth logic
          return validateToken(token);
        },
      },
      cors: {
        enabled: true,
        origins: ['https://trusted-app.com'],
      },
    },
  },
};
```

### Using MCP from Agents

Agents can use MCP resources from external servers:

```typescript
import { agent } from 'veryfront/ai';

const myAgent = agent({
  model: 'gpt-4',

  // Connect to external MCP servers
  mcpServers: [
    {
      url: 'http://localhost:3002/mcp',
      auth: { token: process.env.EXTERNAL_MCP_TOKEN },
    },
  ],

  tools: {
    // Local tools automatically available
  },
});
```

---

## Agent System

### Overview

Agents are the core abstraction for building AI-powered features. An agent encapsulates:

- **Model Configuration**: Which LLM to use (OpenAI, Anthropic, etc.)
- **System Prompt**: Instructions and behavior guidelines
- **Tools**: Functions the agent can call
- **Memory**: Conversation history and context
- **Loop Control**: Multi-step reasoning and tool execution

### Agent Definition

Agents are defined in `ai/agents/`:

```typescript
// ai/agents/customer-support.ts
import { agent, stopWhen, stepCountIs } from 'veryfront/ai';

export default agent({
  id: 'customerSupport', // Optional, inferred from filename

  // Model selection (supports multiple providers)
  model: 'openai/gpt-4', // or 'anthropic/claude-3-5-sonnet', etc.

  // System prompt (can reference prompt templates)
  system: 'customerSupport', // References ai/prompts/customer-support.ts
  // Or inline:
  // system: 'You are a helpful customer support agent...',

  // Tools (auto-discovered from ai/tools/ or explicitly defined)
  tools: {
    searchKnowledgeBase: true, // Auto-discovered tool
    createTicket: true,
    sendEmail: true,
  },

  // Agent behavior
  maxSteps: 20, // Maximum tool calls before stopping
  stopWhen: stepCountIs(20),

  // Streaming support
  streaming: true,

  // Memory configuration
  memory: {
    type: 'conversation', // 'conversation' | 'buffer' | 'summary'
    maxTokens: 4000,
  },

  // Optional: Middleware
  middleware: [
    async (context, next) => {
      console.log('Agent invoked:', context.input);
      return next();
    },
  ],
});
```

### Using Agents

#### In API Routes

```typescript
// app/api/chat/route.ts
import { streamText } from 'veryfront/ai';
import { agents } from '@/ai/agents'; // Auto-imported

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Get agent (type-safe)
  const agent = agents.customerSupport;

  // Stream response
  const stream = await agent.stream({
    messages,
    onToolCall: (tool) => {
      console.log('Tool called:', tool.name);
    },
  });

  return stream.toDataStreamResponse();
}
```

#### In Server Components

```typescript
// app/dashboard/page.tsx (Server Component)
import { agents } from '@/ai/agents';

export default async function DashboardPage() {
  const agent = agents.analyst;

  // Generate insights
  const insights = await agent.generate({
    input: 'Analyze last month\'s sales data',
  });

  return (
    <div>
      <h1>Sales Insights</h1>
      <p>{insights.text}</p>
    </div>
  );
}
```

#### In Client Components

```typescript
// app/chat/page.tsx (Client Component)
'use client';

import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const { messages, input, handleSubmit, handleInputChange, isLoading } = useChat({
    api: '/api/chat', // Endpoint using agent
  });

  return (
    <Chat
      messages={messages}
      input={input}
      onSubmit={handleSubmit}
      onChange={handleInputChange}
      loading={isLoading}
    />
  );
}
```

### Agent Composition

Agents can orchestrate other agents for complex workflows:

```typescript
// ai/agents/orchestrator.ts
import { agent } from 'veryfront/ai';
import { agents } from '@/ai/agents';

export default agent({
  id: 'orchestrator',
  model: 'gpt-4',
  system: 'You coordinate between specialized agents to solve complex tasks.',

  tools: {
    // Agents as tools
    callAnalyst: async (input: string) => {
      const result = await agents.analyst.generate({ input });
      return result.text;
    },

    callWriter: async (input: string) => {
      const result = await agents.writer.generate({ input });
      return result.text;
    },
  },
});
```

### Multi-Modal Agents

Support for vision and audio:

```typescript
// ai/agents/vision-agent.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'gpt-4-vision',
  system: 'Analyze images and provide detailed descriptions.',

  tools: {
    analyzeImage: async ({ imageUrl }: { imageUrl: string }) => {
      // Process image
      return analysis;
    },
  },

  multimodal: {
    vision: true,
    audio: false,
  },
});
```

---

## AI UI Components

### Overview

Veryfront provides a **three-layer architecture** for building AI interfaces, allowing you to choose the right level of abstraction for your needs:

1. **Layer 1: Headless Hooks** - Complete control over logic and UI
2. **Layer 2: Unstyled Primitives** - Composable UI primitives with zero opinions
3. **Layer 3: Styled Components** - Production-ready, fully styled components

This architecture solves a critical problem: **teams need different levels of customization**. MVP teams want speed, design system teams want flexibility, and specialized applications need deep logic control. One architecture serves all three.

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: Styled Components (veryfront/ai/components)        │
│ ─────────────────────────────────────────────────────────── │
│ Production-ready, fully styled components                    │
│ • Chat, AgentCard, WorkflowCanvas                           │
│ • Built on Layer 2 primitives                               │
│ • Tailwind CSS styling                                      │
│ • Theme system for customization                            │
│                                                              │
│ Best for: MVP teams, rapid prototyping                      │
└────────────────────────┬─────────────────────────────────────┘
                         │ Built on top of
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Unstyled Primitives (veryfront/ai/primitives)      │
│ ─────────────────────────────────────────────────────────── │
│ Headless UI primitives with minimal styling                 │
│ • ChatContainer, MessageList, MessageItem, InputBox         │
│ • Built on Radix UI (shadcn-compatible)                     │
│ • Maximum composability                                     │
│ • Bring your own styles                                     │
│                                                              │
│ Best for: Design system teams, custom UIs                   │
└────────────────────────┬─────────────────────────────────────┘
                         │ Uses
                         ↓
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Headless Hooks (veryfront/ai/react)                │
│ ─────────────────────────────────────────────────────────── │
│ All logic, zero UI                                          │
│ • useChat, useAgent, useCompletion, useStreaming            │
│ • Complete control over state & behavior                    │
│ • Build any UI you want                                     │
│ • Customizable retry, caching, error handling               │
│                                                              │
│ Best for: Deep customization, specialized apps              │
└─────────────────────────────────────────────────────────────┘
```

### Layer 1: Headless Hooks

**Import from**: `veryfront/ai/react`

Headless hooks provide complete control over AI interaction logic with zero UI opinions. Build any interface you want.

#### useChat Hook

Complete chat state management:

```typescript
import { useChat } from 'veryfront/ai/react';

function CustomChatUI() {
  const {
    messages,           // Message history
    input,              // Current input value
    isLoading,          // Loading state
    error,              // Error state

    // Actions
    setInput,           // Update input
    append,             // Add message
    reload,             // Retry last message
    stop,               // Stop generation

    // Advanced
    data,               // Extra data from server
    setMessages,        // Manually control messages
  } = useChat({
    api: '/api/chat',
    initialMessages: [],

    // Callbacks
    onResponse: (response) => { /* ... */ },
    onFinish: (message) => { /* ... */ },
    onError: (error) => { /* ... */ },

    // Advanced config
    body: { /* extra data */ },
    headers: { /* custom headers */ },
    credentials: 'include',
  });

  // Build ANY UI you want
  return (
    <YourCompletelyCustomUI
      messages={messages}
      input={input}
      onSubmit={() => append({ role: 'user', content: input })}
    />
  );
}
```

#### useAgent Hook

Agent orchestration with tool execution:

```typescript
import { useAgent } from 'veryfront/ai/react';

function AgentInterface() {
  const {
    messages,
    toolCalls,          // Active tool invocations
    status,             // 'idle' | 'thinking' | 'tool_execution' | 'error'
    thinking,           // Agent reasoning text

    invoke,             // Start agent execution
    stop,               // Stop agent
  } = useAgent({
    agent: 'customerSupport',  // Agent ID

    onToolCall: (tool) => {
      console.log('Tool called:', tool.name, tool.args);
    },

    onToolResult: (tool, result) => {
      console.log('Tool result:', result);
    },
  });

  return <YourAgentUI agent={{ messages, toolCalls, status }} />;
}
```

#### useCompletion Hook

Single text completion:

```typescript
import { useCompletion } from 'veryfront/ai/react';

function CompletionUI() {
  const {
    completion,        // Generated text
    isLoading,
    error,
    complete,          // Trigger completion
    stop,              // Stop generation
  } = useCompletion({
    api: '/api/complete',
  });

  return (
    <div>
      <button onClick={() => complete('Write a haiku')}>
        Generate
      </button>
      <p>{completion}</p>
    </div>
  );
}
```

#### useStreaming Hook

Low-level streaming control:

```typescript
import { useStreaming } from 'veryfront/ai/react';

function CustomStreaming() {
  const {
    data,              // Streaming data chunks
    isStreaming,
    error,
    start,             // Start stream
    stop,              // Stop stream
  } = useStreaming({
    url: '/api/stream',
    onChunk: (chunk) => { /* Process each chunk */ },
    onComplete: () => { /* Stream finished */ },
  });

  // Build custom streaming UI
  return <YourStreamingUI data={data} />;
}
```

### Layer 2: Unstyled Primitives

**Import from**: `veryfront/ai/primitives`

Unstyled, composable primitives built on **Radix UI**. Bring your own styles, perfect for design systems.

#### ChatContainer

Root chat component:

```typescript
import { ChatContainer } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

function DesignSystemChat() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <ChatContainer
      className="flex flex-col h-screen bg-white dark:bg-gray-900"
    >
      <YourCustomHeader />
      <MessageList messages={chat.messages} />
      <YourCustomInput
        value={chat.input}
        onChange={chat.setInput}
        onSubmit={() => chat.append({ role: 'user', content: chat.input })}
      />
    </ChatContainer>
  );
}
```

#### MessageList & MessageItem

Message rendering primitives:

```typescript
import { MessageList, MessageItem } from 'veryfront/ai/primitives';

function Messages({ messages }) {
  return (
    <MessageList className="flex-1 overflow-y-auto p-4 space-y-4">
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          role={msg.role}
          className={cn(
            'flex',
            msg.role === 'user' ? 'justify-end' : 'justify-start'
          )}
        >
          <div
            className={cn(
              'max-w-[70%] rounded-lg px-4 py-2',
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-900'
            )}
          >
            {getTextFromParts(msg.parts)}
          </div>
        </MessageItem>
      ))}
    </MessageList>
  );
}
```

> **Note**: Import `getTextFromParts` from `veryfront/ai` to extract text content from the v5 parts-based message format.

#### InputBox

Input primitive:

```typescript
import { InputBox } from 'veryfront/ai/primitives';

function ChatInput({ value, onChange, onSubmit, isLoading }) {
  return (
    <div className="border-t p-4">
      <InputBox
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        disabled={isLoading}
        placeholder="Type a message..."
        className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}
```

#### Complete Primitive List

**Chat Primitives:**
- `ChatContainer` - Root container
- `MessageList` - Message list container
- `MessageItem` - Individual message
- `MessageRole` - Role indicator (user/assistant)
- `MessageContent` - Message content wrapper
- `InputBox` - Text input
- `SubmitButton` - Submit button
- `LoadingIndicator` - Loading spinner

**Agent Primitives:**
- `AgentContainer` - Agent UI root
- `AgentStatus` - Status indicator
- `ThinkingIndicator` - Thinking animation
- `ToolInvocation` - Tool call display
- `ToolResult` - Tool result display

**All primitives:**
- Built on Radix UI (shadcn-compatible)
- Minimal styling (easily customizable)
- Full TypeScript support
- Accessibility built-in

### Layer 3: Styled Components

**Import from**: `veryfront/ai/components`

Production-ready, fully styled components. Get started in seconds.

#### Message Component

Display individual messages in a conversation:

```typescript
// app/components/chat-message.tsx
import { Message, MessageContent, MessageRole } from 'veryfront/ai/components';

export function ChatMessage({ message }) {
  return (
    <Message role={message.role}>
      <MessageRole>{message.role}</MessageRole>
      <MessageContent message={message} />
    </Message>
  );
}
```

#### Chat Component

Full chat interface with input, messages, and streaming:

```typescript
// app/chat/page.tsx
'use client';

import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <Chat
      messages={chat.messages}
      input={chat.input}
      onSubmit={chat.handleSubmit}
      onChange={chat.handleInputChange}
      isLoading={chat.isLoading}

      // Customization via props
      placeholder="Ask anything..."
      maxHeight="80vh"
      className="custom-chat-class"

      // Theme customization
      theme={{
        message: 'rounded-lg p-4',
        input: 'border-2 focus:ring-blue-500',
        button: 'bg-blue-600 hover:bg-blue-700',
      }}

      // Render prop for custom tool rendering
      renderTool={(tool) => <CustomToolCard tool={tool} />}
    />
  );
}
```

#### Agent Card Component

Display agent status, thinking process, and tool usage:

```typescript
import { AgentCard, AgentStatus, AgentThinking, AgentTools } from 'veryfront/ai/components';

export function AgentDisplay({ agent }) {
  return (
    <AgentCard>
      <AgentStatus status={agent.status} />

      {agent.thinking && (
        <AgentThinking>
          {agent.thinking}
        </AgentThinking>
      )}

      <AgentTools tools={agent.toolCalls} />
    </AgentCard>
  );
}
```

#### Workflow Canvas Component

Visual workflow builder using React Flow:

```typescript
import { WorkflowCanvas, WorkflowNode, WorkflowEdge } from 'veryfront/ai/components';

export function WorkflowBuilder() {
  const [nodes, setNodes] = useState<WorkflowNode[]>([]);
  const [edges, setEdges] = useState<WorkflowEdge[]>([]);

  return (
    <WorkflowCanvas
      nodes={nodes}
      edges={edges}
      onNodesChange={setNodes}
      onEdgesChange={setEdges}

      // Custom node types
      nodeTypes={{
        agent: AgentNode,
        tool: ToolNode,
        condition: ConditionNode,
      }}
    />
  );
}
```

### Streaming Components

Handle streaming responses with built-in components:

```typescript
'use client';

import { StreamingMessage } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export function StreamingChat() {
  const { messages, streamingMessage } = useChat({
    api: '/api/chat',
    streaming: true,
  });

  return (
    <div>
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}

      {streamingMessage && (
        <StreamingMessage
          content={streamingMessage}
          showCursor={true}
          className="animate-pulse"
        />
      )}
    </div>
  );
}
```

### Tool Invocation UI

Visualize tool calls with detailed information:

```typescript
import { ToolInvocation, ToolResult } from 'veryfront/ai/components';

export function ToolDisplay({ toolCall }) {
  return (
    <ToolInvocation
      name={toolCall.name}
      args={toolCall.args}
      status={toolCall.status}
    >
      {toolCall.result && (
        <ToolResult result={toolCall.result} />
      )}
    </ToolInvocation>
  );
}
```

### Component Customization

Components are highly customizable without ejection:

#### 1. Theme Customization

```typescript
import { Chat } from 'veryfront/ai/components';

export default function CustomChat() {
  return (
    <Chat
      theme={{
        container: 'bg-gray-50 rounded-xl shadow-lg',
        message: {
          user: 'bg-blue-500 text-white rounded-r-lg',
          assistant: 'bg-gray-200 text-gray-900 rounded-l-lg',
          system: 'bg-yellow-100 text-yellow-900',
        },
        input: 'border-2 border-gray-300 focus:border-blue-500',
        button: 'bg-blue-600 hover:bg-blue-700 text-white',
      }}
    />
  );
}
```

#### 2. Render Props

```typescript
import { Chat } from 'veryfront/ai/components';

export default function CustomChat() {
  return (
    <Chat
      // Custom message rendering
      renderMessage={(msg) => (
        <MyCustomMessage
          {...msg}
          avatar={getUserAvatar(msg.role)}
          timestamp={formatTime(msg.timestamp)}
        />
      )}

      // Custom tool rendering
      renderTool={(tool) => (
        <MyCustomToolCard
          name={tool.name}
          status={tool.status}
          result={tool.result}
        />
      )}

      // Custom input
      renderInput={(props) => (
        <MyFancyInput {...props} withVoice={true} />
      )}
    />
  );
}
```

#### 3. Composition Pattern

```typescript
import { Chat } from 'veryfront/ai/components';

export default function CustomChat() {
  return (
    <Chat>
      <Chat.Header>
        <h1>Customer Support</h1>
        <StatusIndicator />
      </Chat.Header>

      <Chat.Messages
        renderMessage={CustomMessage}
        showTimestamps={true}
      />

      <Chat.Input
        placeholder="How can we help?"
        multiline={true}
        maxLength={500}
      />

      <Chat.Footer>
        <PoweredByBadge />
      </Chat.Footer>
    </Chat>
  );
}
```

### Choosing Your Layer

| Layer | Use When | Example Use Case | Customization Level |
|-------|----------|------------------|---------------------|
| **Layer 1: Hooks** | Need complete control over logic & UI | Trading platform with custom state management | Total control |
| **Layer 2: Primitives** | Building design system or need UI flexibility | Enterprise app with existing design language | High flexibility |
| **Layer 3: Styled** | Want to ship fast with good defaults | MVP, demo, or standard chat interface | Props & themes |

**Progressive enhancement pattern:**
1. Start with Layer 3 for speed
2. Drop to Layer 2 when you need custom styling
3. Use Layer 1 when you need deep logic control

**Decision tree:**
```
Do you need custom retry logic, state management, or event handling?
├─ YES → Use Layer 1 (Headless Hooks)
└─ NO  → Do you have an existing design system?
         ├─ YES → Use Layer 2 (Unstyled Primitives)
         └─ NO  → Use Layer 3 (Styled Components)
```

### Mixing Layers

You can mix and match layers as needed:

#### Example: Custom UI with Standard State

```typescript
// Use hooks from Layer 1 for state
import { useChat } from 'veryfront/ai/react';
// Use your own UI components
import { MyMessageList, MyInput } from '@/components/custom';

export default function HybridChat() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <div className="flex flex-col h-screen">
      <MyMessageList messages={chat.messages} />
      <MyInput
        value={chat.input}
        onChange={chat.setInput}
        onSubmit={() => chat.append({ role: 'user', content: chat.input })}
      />
    </div>
  );
}
```

#### Example: Primitives with Styled Components

```typescript
// Use primitives from Layer 2 for structure
import { MessageList, MessageItem } from 'veryfront/ai/primitives';
// Use styled component from Layer 3 for input
import { ChatInput } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function MixedChat() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <div>
      {/* Layer 2: Custom styled messages */}
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} className="my-custom-message" />
        ))}
      </MessageList>

      {/* Layer 3: Standard styled input */}
      <ChatInput
        value={chat.input}
        onChange={chat.setInput}
        onSubmit={() => chat.append({ role: 'user', content: chat.input })}
      />
    </div>
  );
}
```

#### Example: All Three Layers

```typescript
// Layer 1: Custom hook for special logic
import { useChat } from 'veryfront/ai/react';

function useAdvancedChat() {
  const chat = useChat({ api: '/api/chat' });

  // Add custom retry logic
  const retryWithBackoff = async () => {
    for (let i = 0; i < 3; i++) {
      try {
        await chat.reload();
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i)));
      }
    }
  };

  return { ...chat, retryWithBackoff };
}

// Layer 2: Primitives for custom messages
import { MessageList, MessageItem } from 'veryfront/ai/primitives';

// Layer 3: Styled input
import { ChatInput } from 'veryfront/ai/components';

export default function AdvancedChat() {
  const chat = useAdvancedChat();

  return (
    <div>
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} className="custom-styling" />
        ))}
      </MessageList>

      <ChatInput {...chat} />

      <button onClick={chat.retryWithBackoff}>
        Retry with backoff
      </button>
    </div>
  );
}
```

### Future: Component Ejection (v2)

For v2, we may add shadcn-style component copying:

```bash
# Copy primitives to your project
npx veryfront@latest add chat-primitives

# Components copied to components/ai/
# Still use hooks from library:
import { useChat } from 'veryfront/ai/react';
```

This will allow teams to:
- Own the UI code (Layer 2 & 3)
- Keep logic in library (Layer 1)
- Get best of both worlds

**Note**: This is planned for v2. For v1, use the three-layer library approach.

---

## Configuration

### veryfront.config.ts

AI features are configured in the main Veryfront config:

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  // Existing Veryfront config
  rendering: {
    mode: 'ssr',
  },

  // New AI configuration
  ai: {
    // Enable AI features
    enabled: true,

    // Default model provider
    defaultProvider: 'openai',

    // Provider configurations
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
        baseURL: 'https://api.openai.com/v1',
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
      google: {
        apiKey: process.env.GOOGLE_AI_KEY,
      },
    },

    // MCP server configuration
    mcp: {
      enabled: true,
      port: 3001,
      auth: {
        type: 'bearer',
        validate: async (token) => {
          return token === process.env.MCP_AUTH_TOKEN;
        },
      },
    },

    // Agent defaults
    agents: {
      defaultMaxSteps: 20,
      defaultStreaming: true,
      memory: {
        type: 'conversation',
        maxTokens: 4000,
      },
    },

    // Tool discovery
    tools: {
      autoDiscover: true,
      directories: ['ai/tools'], // Custom directories
    },

    // Runtime configuration
    runtime: {
      platform: 'auto-detect', // or 'deno' | 'node' | 'bun' | 'cloudflare-workers'

      // Edge-specific optimizations (for Cloudflare Workers)
      edge: {
        enabled: false, // Automatically enabled on CF Workers
        maxAgentSteps: 3,
        streamingOnly: true,
        disableMCP: true,
      },
    },

    // Component configuration
    components: {
      // Default theme for all components
      theme: {
        primary: 'blue',
        radius: 'md',
      },
    },

    // Development
    dev: {
      enablePlayground: true, // AI playground UI
      playgroundPort: 3002,
    },
  },
});
```

### Environment Variables

```bash
# .env.local

# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_KEY=...

# MCP Authentication
MCP_AUTH_TOKEN=secret-token

# Optional: Custom model endpoints
OPENAI_BASE_URL=https://custom-endpoint.com/v1

# Agent configuration
AI_DEFAULT_MODEL=gpt-4
AI_MAX_TOKENS=4000
```

---

## API Reference

### Agent API

```typescript
import { agent, stopWhen, stepCountIs } from 'veryfront/ai';

// Create agent
const myAgent = agent({
  id: string,
  model: string,
  system: string | (() => string),
  tools: Record<string, Tool | boolean>,
  maxSteps?: number,
  streaming?: boolean,
  memory?: MemoryConfig,
  middleware?: Middleware[],
});

// Generate response
const result = await myAgent.generate({
  input: string,
  messages?: Message[],
  context?: Record<string, any>,
});

// Stream response
const stream = await myAgent.stream({
  input: string,
  messages?: Message[],
  onToolCall?: (tool: ToolCall) => void,
  onChunk?: (chunk: string) => void,
});

// Respond (for API endpoints)
const response = await myAgent.respond({
  request: Request,
});
```

### Tool API

```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  id?: string,
  description: string,
  inputSchema: z.ZodSchema,
  execute: async (input: T) => Result,
  mcp?: {
    enabled: boolean,
    requiresAuth: boolean,
  },
});
```

### Resource API

```typescript
import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  pattern: string,
  description: string,
  paramsSchema: z.ZodSchema,
  load: async (params: T) => Data,
  subscribe?: (params: T) => AsyncIterable<Data>,
  mcp?: {
    enabled: boolean,
    cachePolicy: 'no-cache' | 'cache' | 'cache-first',
  },
});
```

### Prompt API

```typescript
import { prompt } from 'veryfront/ai';

export default prompt({
  id: string,
  description: string,
  content: string,
  // Or
  generate: (variables: T) => string,
});
```

### React Hooks

```typescript
import {
  useChat,
  useCompletion,
  useAgent,
} from 'veryfront/ai/react';

// Chat hook
const {
  messages,
  input,
  handleSubmit,
  handleInputChange,
  isLoading,
  error,
} = useChat({
  api: string,
  initialMessages?: Message[],
  onResponse?: (response: Response) => void,
  onError?: (error: Error) => void,
});

// Completion hook
const {
  completion,
  complete,
  isLoading,
  error,
} = useCompletion({
  api: string,
  onResponse?: (response: Response) => void,
});

// Agent hook
const {
  messages,
  toolCalls,
  status,
  invoke,
  isLoading,
} = useAgent({
  agent: Agent,
  onToolCall?: (tool: ToolCall) => void,
});
```

---

## Examples

### Example 1: Simple Chat Application

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'gpt-4',
  system: 'You are a helpful assistant.',
  streaming: true,
});

// app/api/chat/route.ts
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.assistant.stream({ messages });
  return stream.toDataStreamResponse();
}

// app/chat/page.tsx
'use client';

import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

### Example 2: Agent with Tools

```typescript
// ai/tools/search-products.ts
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Search for products in the database',
  inputSchema: z.object({
    query: z.string(),
    category: z.string().optional(),
  }),
  execute: async ({ query, category }) => {
    const products = await db.products.search({ query, category });
    return products;
  },
});

// ai/agents/shopping-assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'gpt-4',
  system: 'You help users find and purchase products.',
  tools: {
    searchProducts: true, // Auto-discovered
  },
});
```

### Example 3: Multi-Agent Workflow

```typescript
// ai/agents/researcher.ts
export default agent({
  model: 'gpt-4',
  system: 'Research information thoroughly.',
  tools: { searchWeb: true },
});

// ai/agents/writer.ts
export default agent({
  model: 'gpt-4',
  system: 'Write engaging articles based on research.',
});

// ai/agents/orchestrator.ts
import { agent } from 'veryfront/ai';
import { agents } from '@/ai/agents';

export default agent({
  model: 'gpt-4',
  system: 'Coordinate research and writing.',
  tools: {
    research: async (topic: string) => {
      const result = await agents.researcher.generate({ input: topic });
      return result.text;
    },
    write: async (research: string) => {
      const result = await agents.writer.generate({ input: research });
      return result.text;
    },
  },
});
```

### Example 4: MCP Resource

```typescript
// ai/resources/users/[userId]/orders.ts
import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  description: 'Get user order history',
  paramsSchema: z.object({
    userId: z.string(),
  }),
  async load({ userId }) {
    return await db.orders.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  },
  subscribe({ userId }) {
    // Real-time updates
    return db.orders.subscribe({ userId });
  },
});
```

### Example 5: Server Component with Agent

```typescript
// app/insights/page.tsx (Server Component)
import { agents } from '@/ai/agents';

export default async function InsightsPage() {
  const data = await fetchAnalyticsData();

  const insights = await agents.analyst.generate({
    input: `Analyze this data and provide insights: ${JSON.stringify(data)}`,
  });

  return (
    <div>
      <h1>Business Insights</h1>
      <div className="prose">
        {insights.text}
      </div>
    </div>
  );
}
```

---

## Migration Guide

### Migrating an Existing Veryfront App

1. **Install AI dependencies**:
```bash
npm install veryfront@latest ai zod
```

2. **Update config**:
```typescript
// veryfront.config.ts
export default {
  // ... existing config
  ai: {
    enabled: true,
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
    },
  },
};
```

3. **Create AI directory structure**:
```bash
mkdir -p ai/{agents,tools,prompts,resources}
```

4. **Add your first agent**:
```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'gpt-4',
  system: 'You are a helpful assistant.',
});
```

5. **Create API route**:
```typescript
// app/api/chat/route.ts
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.assistant.stream({ messages });
  return stream.toDataStreamResponse();
}
```

6. **Create chat page** (components are already included with Veryfront):
```typescript
// app/chat/page.tsx
'use client';

import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

### Choosing Your UI Layer

Veryfront provides three layers - pick the one that matches your needs:

#### Option 1: Start with Layer 3 (Styled Components) - Recommended

**Best for**: MVPs, rapid prototyping, standard interfaces

```typescript
// app/chat/page.tsx
'use client';

import { Chat } from 'veryfront/ai/components';  // Layer 3
import { useChat } from 'veryfront/ai/react';    // Layer 1

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

**Customize via props:**
```typescript
<Chat
  theme={{
    message: { user: 'bg-blue-500', assistant: 'bg-gray-200' },
  }}
  renderMessage={CustomMessage}
/>
```

#### Option 2: Use Layer 2 (Unstyled Primitives)

**Best for**: Design system integration, custom styling

```typescript
// app/chat/page.tsx
'use client';

import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';  // Layer 2
import { useChat } from 'veryfront/ai/react';  // Layer 1

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <ChatContainer className="your-design-system-container">
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} className="your-design-system-message" />
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

#### Option 3: Use Layer 1 (Headless Hooks) Only

**Best for**: Complete custom UI, specialized applications

```typescript
// app/chat/page.tsx
'use client';

import { useChat } from 'veryfront/ai/react';  // Layer 1 only

export default function ChatPage() {
  const { messages, input, setInput, append } = useChat({
    api: '/api/chat',
  });

  // Build completely custom UI
  return (
    <YourCompletelyCustomUI
      messages={messages}
      input={input}
      onChange={setInput}
      onSubmit={() => append({ role: 'user', content: input })}
    />
  );
}
```

#### Progressive Enhancement Path

1. **Start**: Layer 3 (Styled) for speed
2. **Customize styling**: Drop to Layer 2 (Primitives)
3. **Custom logic**: Use Layer 1 (Hooks) only
4. **Mix**: Combine layers as needed

```typescript
// Example: Mix all three
import { useChat } from 'veryfront/ai/react';          // Layer 1: Custom state
import { MessageList } from 'veryfront/ai/primitives'; // Layer 2: Custom messages
import { ChatInput } from 'veryfront/ai/components';   // Layer 3: Standard input

export default function MixedChat() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <div>
      <MessageList>
        {chat.messages.map((msg) => (
          <YourCustomMessage key={msg.id} {...msg} />
        ))}
      </MessageList>
      <ChatInput {...chat} />
    </div>
  );
}
```

### Backward Compatibility

- All existing Veryfront features continue to work unchanged
- AI features are opt-in via `ai.enabled: true`
- No breaking changes to existing APIs
- Zero overhead if AI features are disabled

---

## Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

**Milestone: Core AI Module**

- [ ] Create `src/ai/` module structure
- [ ] Implement agent runtime
- [ ] Add provider integration layer (OpenAI, Anthropic)
- [ ] Create basic agent API (`agent()`, `generate()`, `stream()`)
- [ ] Add configuration system

**Deliverable**: Basic agent that can generate text with OpenAI/Anthropic

### Phase 2: MCP Integration (Weeks 5-8)

**Milestone: Tool & Resource System**

- [ ] Implement tool discovery system
- [ ] Create tool registry and execution engine
- [ ] Add resource discovery and loading
- [ ] Build MCP server adapter
- [ ] Implement MCP protocol handlers

**Deliverable**: Full MCP server exposing auto-discovered tools and resources

### Phase 3: Agent Enhancements (Weeks 9-12)

**Milestone: Production-Ready Agents**

- [ ] Add multi-step reasoning support
- [ ] Implement conversation memory
- [ ] Add streaming support
- [ ] Create agent composition patterns
- [ ] Build agent middleware system

**Deliverable**: Production-ready agents with tools, memory, and streaming

### Phase 4: UI Layer - Headless Hooks (Weeks 13-14)

**Milestone: Layer 1 - Headless Hooks**

- [ ] Implement `useChat` hook with full state management
- [ ] Create `useAgent` hook with tool execution
- [ ] Add `useCompletion` hook for single completions
- [ ] Build `useStreaming` hook for low-level control
- [ ] Add TypeScript types for all hooks
- [ ] Implement streaming utilities
- [ ] Add error handling and retry logic
- [ ] Create comprehensive hook tests

**Deliverable**: Complete headless hook layer (`veryfront/ai/react`)

### Phase 5: UI Layer - Primitives (Weeks 15-16)

**Milestone: Layer 2 - Unstyled Primitives**

- [ ] Build Radix UI-based primitives
- [ ] Create ChatContainer, MessageList, MessageItem
- [ ] Implement InputBox, SubmitButton
- [ ] Add AgentContainer, AgentStatus, ThinkingIndicator
- [ ] Create ToolInvocation, ToolResult primitives
- [ ] Ensure full accessibility (ARIA support)
- [ ] Add TypeScript types for all primitives
- [ ] Create primitive composition examples

**Deliverable**: Complete primitive layer (`veryfront/ai/primitives`)

### Phase 6: UI Layer - Styled Components (Weeks 17-18)

**Milestone: Layer 3 - Styled Components**

- [ ] Build production-ready Chat component
- [ ] Create fully styled Message components
- [ ] Implement AgentCard with tool visualization
- [ ] Build WorkflowCanvas with React Flow
- [ ] Add comprehensive theme system
- [ ] Implement render props for customization
- [ ] Add composition API (Chat.Header, Chat.Messages, etc.)
- [ ] Create StreamingMessage component
- [ ] Build ToolInvocation UI components

**Deliverable**: Complete styled component layer (`veryfront/ai/components`)

### Phase 7: Developer Experience (Weeks 19-20)

**Milestone: DX & Tooling**

- [ ] Create AI playground UI
- [ ] Add agent testing utilities
- [ ] Build tool debugging interface
- [ ] Implement hot reload for agents/tools
- [ ] Create comprehensive docs
- [ ] Add component examples and demos
- [ ] Build platform detection utilities

**Deliverable**: Complete developer experience

### Phase 8: Production Features ✅ COMPLETE

**Milestone: Production Hardening**

- [x] Add rate limiting (3 strategies: fixed-window, sliding-window, token-bucket)
- [x] Implement caching strategies (memory, LRU, TTL)
- [x] Add platform-specific optimizations (edge support) - Completed in Phase 1
- [x] Build runtime detection system - Completed in Phase 1
- [x] Add cost tracking with budget limits and provider pricing
- [x] Build security features (input validation, output filtering, PII detection)
- [x] Create React error boundary for AI components
- [x] Build middleware stack for production features

**Deliverable**: ✅ Production-ready AI Native App Framework - **DELIVERED**

### Phase 9: Advanced Features (Weeks 25-28)

**Milestone: Advanced Capabilities**

- [ ] Multi-modal support (vision, audio)
- [ ] Agent orchestration patterns
- [ ] Workflow builder UI
- [ ] Fine-tuning integration
- [ ] Local model support (Ollama, etc.)
- [ ] shadcn-style component ejection (v2 feature)

**Deliverable**: Advanced AI features

---

## Success Metrics

### Developer Experience
- Time from zero to working AI app: < 5 minutes
- Lines of code to add chat: < 20 lines
- Tool creation time: < 2 minutes

### Performance
- Agent response latency: < 500ms (streaming first token)
- MCP server throughput: > 1000 req/s
- Component render performance: 60fps

### Adoption
- Documentation completeness: 100% API coverage
- Example applications: 10+ production-ready examples
- Community tools: 50+ community-created tools

---

## Open Questions & Future Considerations

### Open Questions

1. **Model Provider Strategy**: Should we abstract all providers behind a unified API or expose provider-specific features?
2. **Memory Persistence**: Where should conversation memory be stored (in-memory, Redis, database)?
3. **Cost Management**: How to help developers track and limit AI API costs?
4. **Local Models**: What's the best way to support local models (Ollama, LM Studio)?
5. **Workflow Builder**: Should we include a visual workflow builder or keep it as a separate package?

### Future Considerations

- **Fine-Tuning**: Integration with fine-tuning services
- **Embeddings**: Built-in vector database for RAG
- **Evaluation**: Agent testing and evaluation framework
- **Observability**: Built-in tracing and monitoring
- **Multi-Tenancy**: Patterns for SaaS applications
- **Edge Deployment**: Optimize for Cloudflare Workers/Deno Deploy

---

## Appendix

### Glossary

- **MCP (Model Context Protocol)**: Standard protocol for connecting AI models to tools and data
- **Agent**: Autonomous AI system that can use tools and reason over multiple steps
- **Tool**: Function that an agent can call to perform actions or retrieve information
- **Resource**: Data source that can be accessed by AI models via MCP
- **Prompt**: System instructions that define agent behavior
- **Stream**: Real-time response delivery as tokens are generated

### References

- [Model Context Protocol Spec](https://modelcontextprotocol.io)
- [xmcp Framework](https://xmcp.dev)
- [Veryfront Documentation](https://veryfront.com)

### Contributing

This is a living specification. Contributions and feedback welcome!

- Discuss on GitHub: [veryfront/discussions](https://github.com/veryfront/veryfront/discussions)
- Submit proposals: Create an issue with `[AI Spec]` prefix
- Share examples: Add to `examples/ai-native/`

---

**Last Updated**: 2025-11-10
**Version**: 1.0.0-draft
**Status**: Open for feedback
