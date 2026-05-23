---
title: "Chat UI"
description: "Use the preset Chat component with the useChat hook."
order: 22
---

`Chat` is a complete chat interface in one component. It includes a composer,
message list, streaming state, loading state, and scroll behavior.

Pair it with `useChat` and an AG-UI route.

For more control, see [Chat composition](./chat-composition.md) (custom layout),
[Chat hooks](./chat-hooks.md) (headless state), and
[Chat theming](./chat-theming.md) (visuals).

## Prerequisites

- A Veryfront project with an AG-UI route, such as `/api/ag-ui` (see
  [Create agent](../getting-started/create-agent.md)).
- A configured provider for the route's agent (see [Providers](./providers.md)).

## Quick setup

Create a client page that points to your AG-UI route:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat();
  return <Chat {...chat} placeholder="Ask me anything..." />;
}
```

`useChat()` connects to `/api/ag-ui` by default and decodes AG-UI SSE into
Veryfront chat messages.
`Chat` renders the input, message list, loading state, and scroll behavior.

Run `veryfront dev`, open [http://localhost:3000](http://localhost:3000), and
send a message. To test the route without the UI, use the curl check in
[Create agent](../getting-started/create-agent.md).

## Add request preprocessing

Use `beforeStream` on `createAgUiHandler` when the route needs to add context,
enforce authorization, or short-circuit a request before the agent runs:

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

Pair this route with the same `useChat()` client setup.
Veryfront wraps untrusted system-role messages returned from `beforeStream`
before they reach the agent, so retrieved documents are treated as reference
data rather than instructions.

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

## Verify it worked

Run `veryfront dev` and open the page that renders `Chat`. Type a message and
submit:

- The composer should clear and a placeholder assistant message should appear
  with a typing indicator.
- Tokens should stream in. The final message should be a non-empty assistant
  reply.
- If you set `suggestions`, selecting a suggestion should populate the input.

If the assistant response is empty, check the dev-server log for provider or
agent errors and confirm the AG-UI route is mounted at `/api/ag-ui`.
