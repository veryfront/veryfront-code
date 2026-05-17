---
title: "Chat UI"
description: "Use the preset Chat component with the useChat hook."
order: 14
---

# Chat UI

Use `Chat` when you want a complete chat interface with one component. Use this guide for the preset path. Use [Chat composition](./chat-composition.md) when you need layout control, [Chat hooks](./chat-hooks.md) when you need headless state, and [Chat theming](./chat-theming.md) when you need visual customization.

Route examples below use the default app router. Veryfront Code also supports mounting the same handlers under `pages/api/**` when `router: "pages"` is enabled.

## Quick setup

Create a client page:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat({ api: "/api/chat" });
  return <Chat {...chat} placeholder="Ask me anything..." />;
}
```

Create the API route:

```ts
// app/api/chat/route.ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("assistant");
```

`createChatHandler` validates requests, prepares chat messages, and streams the agent response. The `Chat` component renders the input, message list, loading state, and scroll behavior.

## Add preprocessing

Use `beforeStream` for RAG, auth checks, or request-specific context without reimplementing the route internals:

```ts
import { createChatHandler } from "veryfront/agent";

export const POST = createChatHandler("rag", {
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
