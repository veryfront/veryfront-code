# Veryfront AI Native Framework - Getting Started

**Version**: 1.0.0
**Status**: ✅ 100% Complete - Production Ready
**Date**: 2025-11-11

---

## 🚀 Quick Start (5 Minutes)

### 1. Install

```bash
npm install veryfront ai zod
```

### 2. Configure

```typescript
// veryfront.config.ts
export default {
  ai: {
    enabled: true,
    providers: {
      openai: { apiKey: process.env.OPENAI_API_KEY },
    },
  },
};
```

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
// ✅ Auto-registered as "search"!
```

### 4. Create an Agent

```typescript
// ai/agents/assistant.ts
import { agent } from 'veryfront/ai';

export default agent({
  model: 'openai/gpt-4',
  system: 'You are a helpful assistant',
  tools: {
    search: true,  // Auto-discovered!
  },
  memory: {
    type: 'conversation',
    maxTokens: 4000,
  },
});
// ✅ Auto-registered as "assistant"!
```

### 5. Build the UI (Choose Your Layer)

**Option A: Layer 3 (Instant - 1 Line)**
```tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default () => <Chat {...useChat({ api: '/api/chat' })} />;
```

**Option B: Layer 2 (Flexible)**
```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const chat = useChat({ api: '/api/chat' });
  return (
    <ChatContainer className="your-design-system">
      <MessageList>
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id}>{msg.content}</MessageItem>
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

**Option C: Layer 1 (Total Control)**
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

// Discovers all tools, agents, resources, prompts
await discoverAll({ baseDir: '.' });
```

### 7. Start Building!

```bash
veryfront dev
# Your AI app is running!
```

---

## 📚 Core Concepts

### Convention Over Configuration

**Drop files in the right directory and they auto-register:**

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

**Zero configuration required!**

### Three-Layer Architecture

**Layer 1: Headless Hooks**
Complete control over logic and UI.

```typescript
const { messages, input, append } = useChat({ api: '/api/chat' });
```

**Layer 2: Unstyled Primitives**
Radix UI-based components. Bring your own styles.

```tsx
<ChatContainer>
  <MessageList>
    <MessageItem>{content}</MessageItem>
  </MessageList>
</ChatContainer>
```

**Layer 3: Styled Components**
Production-ready with sensible defaults.

```tsx
<Chat {...chat} />
```

**Progressive Enhancement**: Start with Layer 3, drop to 2/1 as needed.

### Memory Strategies

**Conversation** - Keeps all messages:
```typescript
memory: { type: 'conversation', maxTokens: 4000 }
```

**Buffer** - Keeps last N messages:
```typescript
memory: { type: 'buffer', maxMessages: 10 }
```

**Summary** - Auto-summarizes:
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

## 🏭 Production Features

### Rate Limiting

```typescript
import { rateLimitMiddleware } from 'veryfront/ai/production';

const agent = agent({
  middleware: [
    rateLimitMiddleware({
      strategy: 'token-bucket',
      maxRequests: 10,
      windowMs: 60000,  // 10 requests per minute
    }),
  ],
});
```

### Response Caching

```typescript
import { cacheMiddleware } from 'veryfront/ai/production';

const agent = agent({
  middleware: [
    cacheMiddleware({
      strategy: 'ttl',
      ttl: 300000,  // 5 minute cache
    }),
  ],
});
```

### Cost Tracking

```typescript
import { costTrackingMiddleware } from 'veryfront/ai/production';

const agent = agent({
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

const agent = agent({
  middleware: [
    securityMiddleware({
      input: {
        maxLength: 1000,
        blockedPatterns: COMMON_BLOCKED_PATTERNS.promptInjection,
        sanitize: true,
      },
      output: {
        filterPII: true,  // Remove emails, phones, SSN, credit cards
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

## 🧪 Testing & Debugging

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

## 🌐 Multi-Runtime Support

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

### Cloudflare Workers (Edge)
```typescript
// Edge-optimized agent
const edgeAgent = agent({
  model: 'gpt-4',
  edge: {
    enabled: true,
    maxSteps: 3,  // Stay under 30s CPU limit
    streaming: true,
  },
});
```

---

## 📖 Complete Example

### Backend (API Route)

```typescript
// app/api/chat/route.ts
import { agents } from '@/ai/agents';

export async function POST(req: Request) {
  const { messages } = await req.json();

  // Use auto-discovered agent
  const stream = await agents.assistant.stream({ messages });

  return stream.toDataStreamResponse();
}
```

### Frontend (All 3 Layers)

**Layer 3 - Quick (1 line):**
```tsx
import { Chat } from 'veryfront/ai/components';
import { useChat } from 'veryfront/ai/react';

export default () => <Chat {...useChat({ api: '/api/chat' })} />;
```

**Layer 2 - Custom Styling:**
```tsx
import { ChatContainer, MessageList, MessageItem } from 'veryfront/ai/primitives';
import { useChat } from 'veryfront/ai/react';

export default function MyChat() {
  const chat = useChat({ api: '/api/chat' });
  return (
    <ChatContainer className="h-screen flex flex-col">
      <MessageList className="flex-1 overflow-y-auto p-4">
        {chat.messages.map((msg) => (
          <MessageItem key={msg.id} className="my-custom-message">
            {msg.content}
          </MessageItem>
        ))}
      </MessageList>
    </ChatContainer>
  );
}
```

**Layer 1 - Total Control:**
```tsx
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

## 🎯 Next Steps

### 1. Run the Full Demo

```bash
cd examples/full-demo
deno run --allow-net --allow-env --allow-read demo.ts
```

### 2. Explore Examples

- `examples/ai-basic/` - Platform detection + basic agent
- `examples/ai-autodiscovery/` - Auto-discovery + MCP server
- `examples/ai-phase3/` - Memory + composition
- `examples/ai-dev-tools/` - Testing + debugging
- `examples/full-demo/` - Complete demo (all features)

### 3. Read the Docs

- `SPEC_AI_NATIVE_FRAMEWORK.md` - Complete specification
- `IMPLEMENTATION_STATUS.md` - Implementation details
- `AI_FRAMEWORK_SUMMARY.md` - Quick reference
- `src/ai/README.md` - Core module docs
- Module-specific READMEs in `src/ai/react/`

### 4. Start Building!

```bash
# Create your app structure
mkdir -p my-ai-app/ai/{tools,agents,resources,prompts}

# Add your first tool
echo "..." > my-ai-app/ai/tools/my-tool.ts

# Run auto-discovery
# Tools and agents are automatically discovered!
```

---

## 💡 Pro Tips

### 1. Use Middleware Stack

Combine production features:

```typescript
const agent = agent({
  middleware: [
    rateLimitMiddleware({...}),
    cacheMiddleware({...}),
    costTrackingMiddleware({...}),
    securityMiddleware({...}),
  ],
});
```

### 2. Test Your Agents

```typescript
import { testAgent } from 'veryfront/ai/dev';

await testAgent(agent, [
  { name: 'Test', input: '...', expected: /.../ },
]);
```

### 3. Monitor Costs

```typescript
import { createCostTracker } from 'veryfront/ai/production';

const tracker = createCostTracker({...});
const summary = tracker.getDailySummary();
console.log(`Daily cost: $${summary.cost.toFixed(2)}`);
```

### 4. Use the Right Layer

- **MVP/Demo**: Layer 3 (styled components)
- **Design System**: Layer 2 (primitives)
- **Specialized App**: Layer 1 (hooks only)

---

## 📚 Documentation

- **Specification**: `SPEC_AI_NATIVE_FRAMEWORK.md`
- **Implementation**: `IMPLEMENTATION_STATUS.md`
- **Summary**: `AI_FRAMEWORK_SUMMARY.md`
- **This Guide**: `AI_GETTING_STARTED.md`
- **Module Docs**: `src/ai/README.md` and subdirectories

---

## 🎉 You're Ready!

The Veryfront AI Native Framework is **100% complete** and **production-ready**.

**Start building AI applications with:**
- ✅ Convention-driven development
- ✅ Multi-runtime support
- ✅ Three-layer UI architecture
- ✅ MCP integration
- ✅ Production features
- ✅ Developer tools

**Happy building! 🚀**
