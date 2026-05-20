---
title: "Chat hooks"
description: "Use headless chat, agent, completion, voice, and thread hooks."
order: 20
---

Three headless hooks expose the chat runtime without the preset UI: `useChat` for AG-UI streaming chat, `useAgent` for direct agent invocation, and `useCompletion` for one-shot text generation. Use them when you want full control of the layout.

Examples below assume an AG-UI endpoint at `/api/ag-ui`. Use the route from [Chat UI](./chat-ui.md) or [Agents](./agents.md), run `veryfront dev`, then open the page that renders the hook.

## Prerequisites

- A page that can render React client components.
- An AG-UI route mounted at `/api/ag-ui` (or another path you pass via `api`).
- For `useCompletion`, an API route that returns plain text or SSE for the
  `complete` call.

## useChat

```tsx
"use client";
import { useChat } from "veryfront/chat";

export default function ChatState() {
  const chat = useChat({ api: "/api/ag-ui" });

  return (
    <form onSubmit={chat.handleSubmit}>
      <input value={chat.input} onChange={chat.handleInputChange} />
      <button disabled={chat.isLoading}>Send</button>
    </form>
  );
}
```

`useChat` exposes messages, input state, submit handlers, stop/reload handlers, model state, branch helpers, and inference status. It uses AG-UI for Veryfront AG-UI routes created with `createAgUiHandler`.

## useAgent

Use `useAgent` for direct agent invocation without the chat protocol:

```tsx
"use client";
import { useAgent } from "veryfront/chat";

export default function AgentPanel() {
  const { messages, invoke, isLoading, status } = useAgent({
    agent: "assistant",
  });

  return (
    <div>
      <button onClick={() => invoke("Analyze this data")} disabled={isLoading}>
        Analyze
      </button>
      <p>Status: {status}</p>
      {messages.map((message, index) => <p key={index}>{message.content}</p>)}
    </div>
  );
}
```

## useCompletion

```tsx
"use client";
import { useCompletion } from "veryfront/chat";

export default function Autocomplete() {
  const { completion, complete, isLoading } = useCompletion({
    api: "/api/complete",
  });

  return (
    <div>
      <button onClick={() => complete("Write a tagline")} disabled={isLoading}>
        Generate
      </button>
      {completion && <p>{completion}</p>}
    </div>
  );
}
```

## Inference mode

`useChat` exposes `inferenceMode` so your UI can show whether inference is running through cloud, server-local, or browser runtime.

## Verify it worked

Render the hook in a page and exercise the surface you care about:

- `useChat`: submit a message. `chat.messages` should grow and `isLoading`
  should flip while the response streams.
- `useAgent`: call `invoke`. `status` should move through `running` to
  `idle` and `messages` should contain the agent's reply.
- `useCompletion`: call `complete`. `completion` should populate and
  `isLoading` should flip back to `false` when the response ends.

If `isLoading` never flips back, check the network tab for the request to
your API and the dev-server log for handler errors.

## Next

- [Chat theming](./chat-theming.md): customize chat features and visuals
- [Workflows](./workflows.md): orchestrate multi-step AI execution

## Related

- [Chat UI](./chat-ui.md): preset component
- [Chat composition](./chat-composition.md): custom layouts
- [`veryfront/chat`](../reference/veryfront/chat.md): chat reference
