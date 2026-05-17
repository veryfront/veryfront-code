---
title: "Chat hooks"
description: "Use headless chat, agent, completion, voice, and thread hooks."
order: 16
---

# Chat hooks

Use chat hooks when you need state and runtime integration without the preset UI.

## useChat

```tsx
"use client";
import { useChat } from "veryfront/chat";

export default function ChatState() {
  const chat = useChat({ api: "/api/chat" });

  return (
    <form onSubmit={chat.handleSubmit}>
      <input value={chat.input} onChange={chat.handleInputChange} />
      <button disabled={chat.isLoading}>Send</button>
    </form>
  );
}
```

`useChat` exposes messages, input state, submit handlers, stop/reload handlers, model state, branch helpers, and inference status.

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

## Next

- [Chat theming](./chat-theming.md): customize chat features and visuals
- [Workflows](./workflows.md): orchestrate multi-step AI execution

## Related

- [Chat UI](./chat-ui.md): preset component
- [Chat composition](./chat-composition.md): custom layouts
- [`veryfront/chat`](../reference/chat.md): chat API reference
