---
title: "Memory and streaming"
description: "Conversation memory strategies and streaming responses."
order: 21
---

Agents are stateless by default: each `stream()` / `generate()` call gets the
messages the client sends, and nothing else. Because nothing is shared between
calls, you can safely reuse one agent instance across concurrent runs. Fanning
out per-item reviews or classifications over a shared instance keeps every run
isolated. Configure `memory` on the agent to persist history across calls, and
use `createAgUiHandler` to stream the response back.

Memory configuration is independent of model selection, so these examples omit
`model` and use `openai/gpt-5.4-nano`.

## Prerequisites

- An agent in `agents/` (see [Agents](./agents.md)).
- An AG-UI route (see [API routes](./api-routes.md) for the
  `createAgUiHandler("assistant")` pattern).
- A storage backend if you choose `conversation` memory; the default in-memory
  driver is fine while developing.

## Choose a memory mode

Configure memory on your agent to persist messages across requests. A configured
agent accumulates **one shared conversation** on the instance, so reuse it
sequentially (a single chat thread) rather than across concurrent independent
runs. For per-item fan-out, create a fresh agent per run instead. To keep the
stateless default explicitly (for a single-shot agent that should never persist
history), set `enabled: false`:

```ts
export default agent({
  system: "You are a one-shot classifier.",
  memory: { type: "conversation", enabled: false }, // never persists across calls
});
```

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

Sliding window based on token count. Drops the oldest messages when the limit is
reached:

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

When the conversation grows long, the agent compresses older messages into a
summary while keeping recent messages intact.

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

Use `createAgUiHandler()` for chat UI routes. It validates the request, invokes
the agent, and returns AG-UI SSE:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

Use `agent.stream()` directly only when you are building a custom transport or
non-chat streaming surface.

### Persisting finished conversations

Pass `onComplete` to persist the finalized conversation server-side after a
successful run — the counterpart to the client-side `useConversationChat` path.
It fires once, only on success, after the stream is fully flushed and closed, so
a slow or throwing persistence never delays or corrupts the response:

```ts
// app/api/ag-ui/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler({
  agent: "assistant",
  onComplete: async ({ threadId, messages, inputMessages, response }) => {
    // `messages` is the finalized assistant turn; `inputMessages` is what was
    // sent. Persist however you like — no need to rebuild it from the stream.
    await db.saveTurn({ threadId, input: inputMessages, output: messages });
  },
});
```

`onComplete` does **not** fire when the run errors or when the client
disconnects before the stream finishes. A rejected callback is caught and logged
rather than rethrown. For `createAgUiRuntimeHandler`, the same finalized
`messages` (and full `response`) arrive on the `onFinish` lifecycle context.

### Client-side consumption

The `useChat` hook handles the streaming protocol automatically:

```tsx
"use client";
import { useChat } from "veryfront/chat";

export default function ChatPage() {
  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
  } = useChat();

  return (
    <div>
      {messages.map((m) => (
        <div key={m.id}>
          {m.parts.map((p) => p.type === "text" ? p.text : null)}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} disabled={isLoading} />
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

The second response should mention "Sam". For streaming, watch the SSE output:
tokens arrive incrementally rather than in one chunk.
