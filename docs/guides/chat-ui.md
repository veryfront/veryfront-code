---
title: "Chat UI"
description: "Use the preset Chat component with the useChat hook."
order: 14
---

# Chat UI

Use `Chat` when you want a complete chat interface with one component. Use this guide for the preset path. Use [Chat composition](./chat-composition.md) when you need layout control, [Chat hooks](./chat-hooks.md) when you need headless state, and [Chat theming](./chat-theming.md) when you need visual customization.

Route examples below use the default app router. Veryfront Code also supports mounting the same handlers under `pages/api/**` when `router: "pages"` is enabled.

## Quick setup

In an app-owned route, create the agent and route below. In a Veryfront-hosted
Studio context, the host can provide the AG-UI route and request-scoped runtime
context, so you usually only configure the client that points at that route.

Create an agent:

```ts
// agents/assistant.ts
import { agent } from "veryfront/agent";

export default agent({
  id: "assistant",
  system: "You are a helpful assistant. Answer concisely.",
});
```

Create a client page:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat", transport: "ag-ui" });
  return <Chat {...chat} placeholder="Ask me anything..." />;
}
```

Create the API route:

```ts
// app/api/chat/route.ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("assistant");
```

`createAgUiHandler` validates the request and streams AG-UI SSE. `useChat({ transport: "ag-ui" })` decodes that stream into Veryfront chat messages. The `Chat` component renders the input, message list, loading state, and scroll behavior.

Run `veryfront dev`, open [http://localhost:3000](http://localhost:3000), and send a message. To test the route without the UI:

```bash
curl -N http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"Say hello."}]}]}'
```

## Add request preprocessing

Use `beforeStream` on `createAgUiHandler` when the route needs to add context, enforce authorization, or short-circuit a request before the agent runs:

```ts
import { createAgUiHandler } from "veryfront/agent";

export const POST = createAgUiHandler("rag", {
  beforeStream: async ({ lastUserText }) => {
    const context = `Search results for: ${lastUserText}`;
    return {
      prepend: [
        {
          role: "system",
          parts: [{ type: "text", text: context }],
        },
      ],
    };
  },
});
```

Pair this route with the same `useChat({ api: "/api/chat", transport: "ag-ui" })` client setup. Veryfront wraps untrusted system-role messages returned from `beforeStream` before they reach the agent, so retrieved documents are treated as reference data rather than instructions.

## Common preset props

```tsx
<Chat
  {...chat}
  placeholder="Ask about your project"
  suggestions={["Summarize this repo", "Find deployment risks"]}
  onSuggestionClick={(value) => chat.setInput(value)}
  showSources
  showMessageActions
/>;
```

## Next

- [Chat composition](./chat-composition.md): build a custom layout with `Chat.Root` and child components
- [Chat hooks](./chat-hooks.md): use `useChat`, `useAgent`, and `useCompletion`
- [Chat theming](./chat-theming.md): customize themes, contexts, and visual behavior

## Related

- [`veryfront/chat`](../reference/chat.md): chat API reference
- [`veryfront/agent`](../reference/agent.md): agent API reference
