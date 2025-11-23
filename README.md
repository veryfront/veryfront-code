# Veryfront

**Build AI agents with React** - Auto-discover tools and agents from your file structure, built-in MCP server, production-ready UI components.

---

## What is Veryfront?

Veryfront is a **modern React framework** for building AI-native applications with **zero configuration**. Create agents, tools, and conversational UIs using file-based conventions - just drop files in the right directories and they're automatically discovered.

**Perfect for:**
- **AI Applications** - Agents, tools, chat interfaces with auto-discovery
- **Multi-Runtime Apps** - Deploy to Deno, Node.js, Bun, or Cloudflare Workers
- **Full-Stack React** - SSR, SSG, ISR, JIT rendering modes with App Router

---

## Quick Start (5 Minutes)

### 1. Install

```bash
# Deno (recommended)
deno add npm:veryfront npm:ai npm:zod

# or Node.js/npm
npm install veryfront ai zod
```

### 2. Create Your AI Agent

**No config needed** - just create the `ai/` directory:

```bash
mkdir -p ai/{agents,tools}
```

**`ai/agents/assistant.ts`:**
```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: {
    search: true,  // Auto-discovered from ai/tools/
  },
});
```

### 3. Add a Tool

**`ai/tools/search.ts`:**
```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Search for information',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    // Your search implementation
    return { results: [...] };
  },
});
```

**Auto-registered as "search"** - ready to use in agents!

### 4. Create Chat API

**`app/api/chat/route.ts`:**
```typescript
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.assistant.stream({ messages });
  return stream.toDataStreamResponse();
}
```

### 5. Add Chat UI

**`app/chat/page.tsx`:**
```tsx
'use client';
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default function ChatPage() {
  const chat = useChat({ api: '/api/chat' });
  return <Chat {...chat} />;
}
```

### 6. Run Your App

```bash
# Add your API key
echo "OPENAI_API_KEY=sk-..." > .env

# Start development server
deno task dev  # or npm run dev
```

Visit **http://localhost:3000/chat**

---

## Project Structure

Veryfront uses **convention over configuration** - just create directories and files in the right places:

```
my-ai-app/
├── .env                        # Add API keys here
├── veryfront.config.ts        # Optional config
│
├── app/                        # Your React app
│   ├── page.tsx
│   ├── chat/page.tsx
│   └── api/chat/route.ts
│
└── ai/                         # Auto-discovered
    ├── agents/                 # Add agents here → auto-registered
    │   └── assistant.ts
    │
    ├── tools/                  # Add tools here → auto-discovered
    │   └── search.ts
    │
    ├── prompts/                # Add prompts here
    │   └── system.ts
    │
    └── resources/              # Add resources here → exposed via MCP
        └── users/[userId]/profile.ts
```

**Key Convention:** The presence of the `ai/` directory **auto-enables** AI features. No config required!

---

## Building AI Apps

### Step 1: Create an Agent

Agents are AI assistants that can use tools and have memory.

**`ai/agents/assistant.ts`:**
```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',                    // LLM to use
  system: 'You are a helpful assistant.',   // Instructions
  tools: { search: true },                  // Available tools
  streaming: true,                          // Real-time responses
  memory: {
    type: 'conversation',                   // Keep conversation history
    maxTokens: 4000,
  },
});
```

**Auto-registered** as `assistant` from filename

### Step 2: Add Tools

Tools are functions your agents can call.

**`ai/tools/calculator.ts`:**
```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Perform calculations',
  inputSchema: z.object({
    expression: z.string(),
  }),
  execute: async ({ expression }) => {
    return { result: eval(expression) };
  },
});
```

**Auto-discovered** and available to all agents

### Step 3: Create API Endpoint

**`app/api/chat/route.ts`:**
```typescript
import { agents } from '@/ai/agents';  // Auto-imported!

export async function POST(req: Request) {
  const { messages } = await req.json();

  const stream = await agents.assistant.stream({
    messages,
    onToolCall: (tool) => {
      console.log('Tool called:', tool.name);
    },
  });

  return stream.toDataStreamResponse();
}
```

### Step 4: Build the UI

Choose your level of control:

**Option A: Styled Components (Fastest)**
```tsx
'use client';
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default () => <Chat {...useChat({ api: '/api/chat' })} />;
```

**Option B: Primitives (Custom Styling)**
```tsx
'use client';
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

export default function CustomChat() {
  const chat = useChat({ api: '/api/chat' });

  return (
    <ChatContainer className="your-styles">
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id}>{msg.content}</MessageItem>
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

**Option C: Headless Hooks (Total Control)**
```tsx
'use client';
import { useChat } from 'veryfront/ai/react';

export default function HeadlessChat() {
  const { messages, input, setInput, append } = useChat({
    api: '/api/chat'
  });

  return <YourCompletelyCustomUI {...{ messages, input }} />;
}
```

---

## MCP Server (Optional)

The **Model Context Protocol** server exposes your tools to external AI applications.

### Enable MCP

MCP is **enabled by default** when you have the `ai/` directory. Optionally configure:

**`veryfront.config.ts`:**
```typescript
export default {
  ai: {
    mcp: {
      port: 3001,                              // Default port
      auth: {
        type: 'bearer',
        validate: async (token) => isValid(token),
      },
    },
  },
};
```

### Start MCP Server

```bash
# With main app
deno task dev --mcp

# Standalone
deno task mcp
```

### Add MCP Resources

Resources expose data to AI models:

**`ai/resources/users/[userId]/profile.ts`:**
```typescript
import { resource } from 'veryfront/ai';
import { z } from 'zod';

export default resource({
  description: 'Get user profile',
  paramsSchema: z.object({ userId: z.string() }),

  async load({ userId }) {
    return await db.users.findUnique({ where: { id: userId } });
  },
});
```

→ Exposed at `mcp://localhost:3001/users/:userId/profile`

---

## Key Features

### AI-Native Core
- **Zero Config** - Create `ai/` directory, features auto-enable
- **Auto-Discovery** - Agents and tools registered from file structure
- **MCP Built-In** - Model Context Protocol server included
- **Three-Layer UI** - Hooks → Primitives → Styled Components (choose your level)

### Modern React Framework
- **Multi-Runtime** - Deno, Node.js, Bun, Cloudflare Workers
- **Flexible Rendering** - SSR, SSG, ISR, JIT, RSC (experimental)
- **App Router** - Nested layouts, file-based routing
- **TypeScript First** - End-to-end type safety

### Production Ready
- **Rate Limiting** - Token bucket, sliding window, fixed window
- **Caching** - Memory, LRU, TTL strategies
- **Cost Tracking** - Budget limits, provider pricing
- **Security** - Input validation, PII filtering, sanitization

---

## Documentation

### Getting Started
- **[Quick Start Tutorial](./docs/learn/quickstart.md)** - Build your first app in 30 minutes
- **[Project Structure](./docs/learn/project-structure.md)** - Understanding the file organization
- **[Convention over Configuration](./docs/learn/concepts/convention-over-configuration.md)** - Core philosophy

### AI Capabilities
- **[AI Getting Started](./docs/ai/getting-started.md)** - Build agents in 5 minutes
- **[AI Specification](./docs/ai/specification.md)** - Complete technical specification
- **[AI Summary](./docs/ai/summary.md)** - Quick reference guide
- **[Implementation Status](./docs/ai/implementation-status.md)** - What's built

### Guides
- **[Routing](./docs/guides/routing/README.md)** - App Router, Pages Router, API Routes
- **[Rendering](./docs/guides/rendering/README.md)** - SSR, SSG, ISR, JIT, RSC
- **[Deployment](./docs/guides/deployment/README.md)** - Deno, Node, Bun, Cloudflare
- **[Components](./docs/guides/components/README.md)** - Link, Head, Image, Script
- **[Hooks](./docs/guides/hooks/README.md)** - useRouter, useParams, usePathname

### Reference
- **[Configuration](./docs/reference/configuration/README.md)** - veryfront.config.ts reference
- **[CLI Commands](./docs/reference/cli/README.md)** - Command-line interface
- **[AI Reference](./docs/reference/ai/README.md)** - agent(), tool(), resource() APIs
- **[File Conventions](./docs/reference/file-conventions/README.md)** - File naming rules

**[→ Browse All Documentation](./docs/README.md)**

---

## Examples

Check out working examples in the `examples/` directory:

- **[ai-basic/](./examples/ai-basic/)** - Simple agent with platform detection
- **[ai-autodiscovery/](./examples/ai-autodiscovery/)** - Auto-discovery + MCP server
- **[ai-memory-workflow/](./examples/ai-memory-workflow/)** - Memory + multi-agent workflows
- **[ai-dev-tools/](./examples/ai-dev-tools/)** - Testing + debugging tools
- **[full-demo/](./examples/full-demo/)** - Complete demonstration of all features

### Run an Example

```bash
cd examples/ai-basic
deno run --allow-all demo.ts
```

---

## What Makes Veryfront Special?

### Convention over Configuration
Drop files in the `ai/` directory and they're automatically discovered - no registration needed.

### Three-Layer UI Architecture
Choose your abstraction level:
1. **Hooks** (`useChat`, `useAgent`) - Total control
2. **Primitives** (Radix UI components) - Bring your own styles
3. **Components** (Production-ready) - Ship fast

### Multi-Runtime Support
Write once, deploy anywhere:
- **Deno** - Secure by default, native TypeScript
- **Node.js** - Full ecosystem compatibility
- **Bun** - Blazing fast performance
- **Cloudflare Workers** - Edge deployment with auto-optimizations

### Production-Ready AI
Built-in rate limiting, caching, cost tracking, and security middleware for production AI apps.

---

## Status

**Version:** 0.1.0 (Pre-release)
**AI Framework:** 100% Complete - Production Ready
**Core Framework:** Stable
**Platform Adapters:** Beta (Node.js, Bun, CF Workers)
**RSC:** Experimental

---

## Contributing

We welcome contributions! See **[Contributing Guide](./docs/community/contributing.md)** for details.

**Quick Links:**
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Architecture Overview](./docs/guides/architecture/README.md)
- [GitHub Discussions](https://github.com/veryfront/veryfront/discussions)

---

## License

MIT License - see [LICENSE](./LICENSE)

---

## Learn More

- **Website:** [veryfront.com](https://veryfront.com) 
- **Documentation:** [./docs/](./docs/)
- **Examples:** [./examples/](./examples/)
- **GitHub:** [github.com/veryfront/veryfront](https://github.com/veryfront/veryfront)
