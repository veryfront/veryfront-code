# Veryfront AI - Getting Started

Build AI-powered applications with Veryfront's native AI framework.

---

## Quick Start

### 1. Install Dependencies

```bash
npm install veryfront ai zod
```

### 2. Configure API Key

```bash
echo "OPENAI_API_KEY=sk-..." > .env
```

Providers auto-initialize from environment variables:

| Variable | Provider |
|----------|----------|
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `GOOGLE_API_KEY` | Google |

### 3. Create a Tool

```typescript
// ai/tools/search.ts
import { tool } from 'veryfront/ai';
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
// Auto-registered as "search"
```

### 4. Create an Agent

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant',
  tools: {
    search: true,  // Auto-discovered
  },
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
// Auto-registered as "assistant"
```

### 5. Build the UI

**Layer 3 - Styled Components (Fastest)**
```tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default () => <Chat {...useChat({ api: '/api/chat' })} />;
```

**Layer 2 - Unstyled Primitives (Customizable)**
```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const chat = useChat({ api: '/api/chat' });
  return (
    <ChatContainer className="your-design-system">
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} />
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

**Layer 1 - Headless Hooks (Total Control)**
```tsx
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const { messages, input, append } = useChat({ api: '/api/chat' });
  return <YourCompletelyCustomUI />;
}
```

### 6. Run Auto-Discovery

```typescript
import { discoverAll } from 'veryfront/ai';

await discoverAll({ baseDir: '.' });
```

### 7. Start Development Server

```bash
veryfront dev
```

---

## Core Concepts

### Convention Over Configuration

Drop files in the right directory and they auto-register:

```
ai/
├── tools/
│   └── search.ts       → "search" tool
├── agents/
│   └── assistant.ts    → "assistant" agent
├── resources/
│   └── docs/[id]/
│       └── content.ts  → "/docs/:id/content" resource
└── prompts/
    └── system.ts       → "system" prompt
```

### Three-Layer Architecture

| Layer | Purpose | Use Case |
|-------|---------|----------|
| **Layer 1: Hooks** | Logic only | Custom UI frameworks |
| **Layer 2: Primitives** | Unstyled components | Design system integration |
| **Layer 3: Components** | Styled, ready-to-use | Quick prototypes, MVPs |

Start with Layer 3, drop to Layer 2 or 1 as customization needs grow.

### Memory Strategies

**Conversation** - Retains all messages up to token limit:
```typescript
memory: { type: 'conversation', maxTokens: 4000 }
```

**Buffer** - Retains last N messages:
```typescript
memory: { type: 'buffer', maxMessages: 10 }
```

**Summary** - Auto-summarizes older messages:
```typescript
memory: { type: 'summary', maxMessages: 20 }
```

### Agent Composition

**Agents as Tools:**
```typescript
import { agentAsTool } from 'veryfront/ai';

const orchestrator = agent({
  tools: {
    research: agentAsTool(researchAgent, 'Research topics'),
    write: agentAsTool(writerAgent, 'Write content'),
  },
});
```

**Multi-Agent Workflows:**
```typescript
import { createWorkflow } from 'veryfront/ai';

const workflow = createWorkflow({
  steps: [
    { agent: researcher, name: 'research' },
    { agent: writer, name: 'write' },
  ],
});

const result = await workflow.execute('Topic');
```

---

## Production Features

### Rate Limiting

```typescript
import { rateLimitMiddleware } from 'veryfront/ai/production';

const myAgent = agent({
  middleware: [
    rateLimitMiddleware({
      strategy: 'token-bucket',
      maxRequests: 10,
      windowMs: 60000,
    }),
  ],
});
```

### Response Caching

```typescript
import { cacheMiddleware } from 'veryfront/ai/production';

const myAgent = agent({
  middleware: [
    cacheMiddleware({
      strategy: 'ttl',
      ttl: 300000,  // 5 minutes
    }),
  ],
});
```

### Cost Tracking

```typescript
import { costTrackingMiddleware } from 'veryfront/ai/production';

const myAgent = agent({
  middleware: [
    costTrackingMiddleware({
      pricing: {
        openai: {
          input: 30.0,   // $30 per 1M tokens
          output: 60.0,  // $60 per 1M tokens
        },
      },
      limits: {
        daily: 10.0,  // $10 daily limit
      },
      onLimitExceeded: (usage) => {
        console.warn('Budget exceeded!', usage);
      },
    }),
  ],
});
```

### Security

```typescript
import { securityMiddleware, COMMON_BLOCKED_PATTERNS } from 'veryfront/ai/production';

const myAgent = agent({
  middleware: [
    securityMiddleware({
      input: {
        maxLength: 1000,
        blockedPatterns: COMMON_BLOCKED_PATTERNS.promptInjection,
        sanitize: true,
      },
      output: {
        filterPII: true,
      },
    }),
  ],
});
```

### Error Boundary

```tsx
import { AIErrorBoundary } from 'veryfront/ai/components';

<AIErrorBoundary
  fallback={(error, reset) => (
    <div>
      <p>Error: {error.message}</p>
      <button onClick={reset}>Try Again</button>
    </div>
  )}
>
  <Chat {...chat} />
</AIErrorBoundary>
```

---

## Testing & Debugging

### Test Agents

```typescript
import { testAgent, printTestResults } from 'veryfront/ai/dev';

const results = await testAgent(myAgent, [
  {
    name: 'Greeting',
    input: 'Hello',
    expected: /hi|hello/i,
  },
  {
    name: 'Tool usage',
    input: 'Search for AI',
    expectToolCalls: ['search'],
  },
]);

printTestResults(results);
```

### Test Tools

```typescript
import { testTool } from 'veryfront/ai/dev';

const results = await testTool(calculatorTool, [
  {
    name: 'Addition',
    input: { operation: 'add', a: 2, b: 3 },
    expectedOutput: { result: 5 },
  },
]);
```

### Inspect Execution

```typescript
import { inspectAgent, printInspectionReport } from 'veryfront/ai/dev';

const report = await inspectAgent(agent, 'Test input');
printInspectionReport(report);
```

---

## Multi-Runtime Support

### Deno (Recommended)
```bash
deno run --allow-net --allow-env --allow-read main.ts
```

### Node.js
```bash
node main.js
```

### Bun
```bash
bun run main.ts
```

### Cloudflare Workers
```typescript
const edgeAgent = agent({
  model: 'gpt-4',
  edge: {
    enabled: true,
    maxSteps: 3,
    streaming: true,
  },
});
```

---

## Agentic Workflows

Combine planners, executors, and MCP resources for multi-step automation:

```typescript
import { agent, createWorkflow } from 'veryfront/ai';
import { z } from 'zod';

const planner = agent({
  model: 'openai/gpt-4o-mini',
  system: 'Plan the work and delegate to tools',
  tools: { search: true, browseWeb: true },
});

const executor = agent({
  model: 'openai/gpt-4o',
  system: 'Execute the plan and ship the artifact',
  tools: { writeMarkdown: true },
  resources: 'auto',
});

const workflow = createWorkflow({
  inputSchema: z.object({ goal: z.string() }),
  steps: [
    { name: 'plan', agent: planner },
    { name: 'deliver', agent: executor, input: ({ plan }) => plan.tasks },
  ],
});

const { result, transcript } = await workflow.run({
  goal: 'Publish a launch brief',
  resources: ['mcp://github/issues', 'mcp://notion/notes'],
});
```

---

## Complete Example

### Backend (API Route)

```typescript
// app/api/chat/route.ts
import { agents } from '../../../ai/agents';

export async function POST(req: Request) {
  return agents.assistant.respond(req);
}
```

### Frontend

```tsx
// Layer 3 (1 line)
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default () => <Chat {...useChat({ api: '/api/chat' })} />;
```

```tsx
// Layer 2 (Custom styling)
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const chat = useChat({ api: '/api/chat' });
  return (
    <ChatContainer className="h-screen flex flex-col">
      <MessageList className="flex-1 overflow-y-auto p-4">
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} message={msg} className="my-custom-message" />
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

```tsx
// Layer 1 (Total control)
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const { messages, input, setInput, append } = useChat({
    api: '/api/chat',
  });

  return (
    <MyCompletelyCustomUI
      messages={messages}
      input={input}
      onChange={setInput}
      onSubmit={() => append({ role: 'user', content: input })}
    />
  );
}
```

---

## Next Steps

1. **Run Examples**
   - `examples/ai-basic/` - Platform detection + basic agent
   - `examples/ai-autodiscovery/` - Auto-discovery + MCP server
   - `examples/ai-phase3/` - Memory + composition
   - `examples/full-demo/` - All features

2. **Read Documentation**
   - [AI Overview](./README.md) - Complete AI capabilities
   - [Agent Reference](/reference/ai/agent.md) - Agent API
   - [Tools Reference](/reference/ai/tools.md) - Tool API
   - [Hooks Reference](/reference/ai/hooks.md) - React hooks

3. **Start Building**
   ```bash
   mkdir -p my-ai-app/ai/{tools,agents,resources,prompts}
   ```

---

## Tips

### Middleware Stack

Combine production features:

```typescript
const myAgent = agent({
  middleware: [
    rateLimitMiddleware({...}),
    cacheMiddleware({...}),
    costTrackingMiddleware({...}),
    securityMiddleware({...}),
  ],
});
```

### Choosing a Layer

| Scenario | Recommended Layer |
|----------|-------------------|
| MVP / Demo | Layer 3 (styled components) |
| Design system integration | Layer 2 (primitives) |
| Specialized UI requirements | Layer 1 (hooks only) |

### Monitor Costs

```typescript
import { createCostTracker } from 'veryfront/ai/production';

const tracker = createCostTracker({...});
const summary = tracker.getDailySummary();
console.log(`Daily cost: $${summary.cost.toFixed(2)}`);
```

---

## Related Documentation

- [AI Overview](./README.md) - Complete AI capabilities overview
- [Agent Reference](/reference/ai/agent.md) - Agent API reference
- [Tools Reference](/reference/ai/tools.md) - Tool API reference
- [Hooks Reference](/reference/ai/hooks.md) - React hooks for AI features
- [Integrations](/reference/ai/integrations.md) - Service integrations
