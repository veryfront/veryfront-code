---
title: "Memory and streaming"
description: "Conversation memory strategies and streaming responses."
order: 13
---

# Memory and streaming

Conversation memory strategies and streaming responses.

Route examples below use the default app router. Veryfront Code also supports mounting the same handlers under `pages/api/**` when `router: "pages"` is enabled.

Memory configuration is independent of model selection, so these examples omit
`model` and follow the runtime default.

To test these examples, define the agent, expose it through the `/api/ag-ui` route shown below, run `veryfront dev`, and send messages from the [Chat UI](./chat-ui.md) guide or with `curl`.

## Prerequisites

- An agent in `agents/` (see [Agents](./agents.md)).
- An AG-UI route (see [API routes](./api-routes.md) for the
  `createAgUiHandler("assistant")` pattern).
- A storage backend if you choose `conversation` memory; the default in-memory
  driver is fine while developing.

## Memory types

Configure memory on your agent to persist messages across requests:

### Buffer memory

Keeps the last N messages. Simple and predictable:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant.",
  memory: {
    type: "buffer",
    maxMessages: 50,
  },
});
```

### Conversation memory

Sliding window based on token count. Drops the oldest messages when the limit is reached:

```ts
export default agent({
  system: "You are a helpful assistant.",
  memory: {
    type: "conversation",
    maxTokens: 4000,
  },
});
```

### Summary memory

Automatically summarizes older messages to fit more context into fewer tokens:

```ts
export default agent({
  system: "You are a research assistant.",
  memory: {
    type: "summary",
  },
});
```

When the conversation grows long, the agent compresses older messages into a summary while keeping recent messages intact.

### Redis memory

For production deployments where multiple server instances share state:

```ts
import { agent, createRedisMemory } from "veryfront/agent";
import { getEnv } from "veryfront";
import Redis from "ioredis";

const redis = new Redis(getEnv("REDIS_URL"));

export default agent({
  system: "You are a support agent.",
  memory: createRedisMemory("support", {
    type: "redis",
    client: redis,
    keyPrefix: "chat:memory:",
    ttl: 86400, // 24 hours
  }),
});
```

## Memory operations

Access memory programmatically in API routes:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler, getAgent } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");

export async function DELETE() {
  const agent = getAgent("assistant");
  await agent.clearMemory();
  return new Response(null, { status: 204 });
}

export async function GET() {
  const agent = getAgent("assistant");
  const messages = await agent.getMemory();
  const stats = await agent.getMemoryStats();
  return Response.json({ messages, stats });
}
```

`getMemoryStats()` returns:

```ts
{
  totalMessages: 24,
  estimatedTokens: 3200,
  type: "buffer"
}
```

## Streaming

### Server-side streaming

Use `createAgUiHandler()` for chat UI routes. It validates the request, invokes the agent, and returns AG-UI SSE:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

Use `agent.stream()` directly only when you are building a custom transport or non-chat streaming surface.

### Client-side consumption

The `useChat` hook handles the streaming protocol automatically:

```tsx
"use client";
import { useChat } from "veryfront/chat";

export default function ChatPage() {
  const { messages, input, onChange, onSubmit, isLoading } = useChat({
    api: "/api/ag-ui",
  });

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>{m.parts.map((p) => p.type === "text" ? p.text : null)}</div>
      ))}
      <form onSubmit={onSubmit}>
        <input value={input} onChange={onChange} disabled={isLoading} />
      </form>
    </div>
  );
}
```

### Non-streaming generation

Use `generate()` when you need the complete response at once:

```ts
const agent = getAgent("assistant");
const result = await agent.generate({
  input: "Write a haiku about programming.",
});
// result.text: full text response
// result.usage: { promptTokens, completionTokens, totalTokens }
```

## Client-managed vs server-managed memory

There are two patterns for conversation history:

**Client-managed** (default with `useChat`): The client sends the full message array on each request. The server is stateless. Good for simple chat UIs.

**Server-managed** (with agent memory): The server persists messages. The client sends only the latest message. Good for long-running conversations and multi-device access.

You can combine both: use client memory for the UI and server memory for context that persists across sessions.

## Verify it worked

Send two messages on the same `threadId` (with `conversation` memory) and
confirm the second response references the first message. With `curl`:

```bash
THREAD=$(uuidgen)
curl -s http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"$THREAD\",\"messages\":[{\"id\":\"1\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"My name is Sam.\"}]}]}"
curl -s http://localhost:3000/api/ag-ui \
  -H "Content-Type: application/json" \
  -d "{\"threadId\":\"$THREAD\",\"messages\":[{\"id\":\"2\",\"role\":\"user\",\"parts\":[{\"type\":\"text\",\"text\":\"What is my name?\"}]}]}"
```

The second response should mention "Sam". For streaming, watch the SSE
output: tokens arrive incrementally rather than in one chunk.

## Next

- [Chat UI](./chat-ui.md): pre-built components for chat interfaces
- [Workflows](./workflows.md): orchestrate multiple agents

## Related

- [`veryfront/agent`](../reference/agent.md): agent API reference
- [`veryfront/chat`](../reference/chat.md): chat hooks API reference
