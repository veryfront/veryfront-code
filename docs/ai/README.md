# AI Capabilities

Veryfront provides native AI capabilities including autonomous agents, auto-discovered tools, and Model Context Protocol (MCP) integration.

## Overview

The AI system enables you to:

- Create autonomous agents that can use tools to accomplish tasks
- Define tools with type-safe schemas that agents can invoke
- Build MCP servers to expose resources to external AI applications
- Use React hooks and components for chat interfaces

## Quick Start

```typescript
// ai/tools/search.ts
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Search the knowledge base',
  inputSchema: z.object({
    query: z.string(),
  }),
  execute: async ({ query }) => {
    const results = await searchKnowledgeBase(query);
    return { results };
  },
});
```

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant.',
  tools: {
    search: true, // Auto-discovered from ai/tools/search.ts
  },
});
```

```typescript
// app/api/chat/route.ts
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();
  const stream = await agents.assistant.stream({ messages });
  return stream.toDataStreamResponse();
}
```

## Documentation

### Guides

- [Getting Started](./getting-started.md) - Build your first agent

### API Reference

- [Agent API](../reference/ai/agent.md) - Agent configuration and methods
- [Tool API](../reference/ai/tools.md) - Tool definition and execution
- [React Hooks](../reference/ai/hooks.md) - useAgent, useChat, useCompletion
- [Integrations](../reference/ai/integrations.md) - Third-party service integrations

## Core Concepts

### Agents

Agents are autonomous entities that can process messages, use tools, and maintain conversation context.

```typescript
import { agent } from 'veryfront/ai';

export default agent({
  model: 'anthropic/claude-3-5-sonnet',
  system: 'You are a customer support agent.',
  tools: {
    searchKB: true,
    createTicket: true,
  },
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
```

### Tools

Tools are functions that agents can invoke. They are automatically discovered from the `ai/tools/` directory.

```typescript
import { tool } from 'veryfront/ai';
import { z } from 'zod';

export default tool({
  description: 'Create a support ticket',
  inputSchema: z.object({
    title: z.string(),
    description: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  execute: async ({ title, description, priority }) => {
    const ticket = await createTicket({ title, description, priority });
    return { ticketId: ticket.id };
  },
});
```

### MCP Resources

Expose data to external AI applications via Model Context Protocol.

```typescript
import { resource } from 'veryfront/ai';

export default resource({
  pattern: '/users/{id}',
  description: 'User profile data',
  fetch: async ({ params }) => {
    const user = await getUser(params.id);
    return { data: user };
  },
});
```

### React Integration

Use hooks for client-side AI interactions.

```tsx
'use client';

import { useChat } from 'veryfront/ai/react';

export function ChatInterface() {
  const { messages, input, handleSubmit, handleInputChange } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.content}</div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

## Supported Providers

| Provider | Models | Status |
|----------|--------|--------|
| OpenAI | gpt-4, gpt-4-turbo, gpt-3.5-turbo | Stable |
| Anthropic | claude-3-5-sonnet, claude-3-opus, claude-3-haiku | Stable |
| Google | gemini-pro, gemini-1.5-pro | Stable |

## Production Features

### Rate Limiting

```typescript
import { rateLimitMiddleware } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  middleware: [
    rateLimitMiddleware({ maxRequests: 100, windowMs: 60000 }),
  ],
});
```

### Response Caching

```typescript
import { cacheMiddleware } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  middleware: [
    cacheMiddleware({ strategy: 'ttl', ttl: 300000 }),
  ],
});
```

### Cost Tracking

```typescript
import { costTrackingMiddleware } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  middleware: [
    costTrackingMiddleware({ budgetLimit: 100 }),
  ],
});
```

## Configuration

Enable AI features in `veryfront.config.ts`:

```typescript
import { defineConfig } from 'veryfront';

export default defineConfig({
  ai: {
    enabled: true,
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY,
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY,
      },
    },
  },
});
```

## File Structure

```
ai/
├── agents/           # Agent definitions (auto-discovered)
│   └── assistant.ts
├── tools/            # Tool definitions (auto-discovered)
│   ├── search.ts
│   └── create-ticket.ts
├── prompts/          # Reusable prompts (auto-discovered)
│   └── system.ts
└── resources/        # MCP resources (auto-discovered)
    └── users/[id]/
        └── resource.ts
```

## Related Documentation

- [API Routes](../guides/routing/api-routes.md) - Create agent endpoints
- [App Router](../guides/routing/app-router.md) - Integrate agents in pages
- [Configuration](../reference/configuration/README.md) - AI configuration options
- [Deployment](../guides/deployment/README.md) - Deploy AI-powered apps
