---
title: "Chat composition"
description: "Build custom chat layouts with Chat and Message composition components."
order: 23
---

When the preset `Chat` component is too constrained, build a custom layout from `Chat.Root`, `Chat.MessageList`, `Chat.Composer`, and the `Message` compound components. Veryfront still owns the streaming, loading state, and message wiring.

The examples reuse the `useChat({ api: "/api/ag-ui" })` setup from [Chat UI](./chat-ui.md). Create the AG-UI route first, then render these components in a client page and verify with `veryfront dev`.

## Prerequisites

- A working preset Chat UI (see [Chat UI](./chat-ui.md)).
- The `/api/ag-ui` route mounted with `createAgUiHandler`.

## Layout components

```tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function CustomLayout() {
  const chat = useChat({ api: "/api/ag-ui" });

  return (
    <Chat.Root {...chat}>
      <header className="border-b p-4">
        <h1>Assistant</h1>
      </header>
      <Chat.MessageList messages={chat.messages} />
      <Chat.Composer
        input={chat.input}
        onChange={chat.handleInputChange}
        onSubmit={chat.handleSubmit}
      />
    </Chat.Root>
  );
}
```

## Empty state

```tsx
<Chat.Empty
  title="What can I help with?"
  suggestions={["Explain React hooks", "Write a regex"]}
  onSuggestionClick={(value) => chat.setInput(value)}
/>;
```

## Message compound components

Use `Message` when individual message rendering needs custom structure:

```tsx
import { Message } from "veryfront/chat";

<Message.Root message={message}>
  <Message.Avatar />
  <Message.Content />
  <Message.Actions />
</Message.Root>;
```

## Sidebar with threads

```tsx
import { ChatWithSidebar, useChat } from "veryfront/chat";

function App() {
  const chat = useChat({ api: "/api/ag-ui" });
  return (
    <ChatWithSidebar
      chat={chat}
      sidebar={{ storageKey: "my-app" }}
    />
  );
}
```

## Verify it worked

Render your composed layout in a client page, run `veryfront dev`, and:

- Confirm the header, message list, and composer all render where you placed
  them.
- Submit a message and confirm tokens stream into the message list (the same
  AG-UI flow as the preset `Chat` component).
- For `Message` compound components, confirm avatar, content, and actions
  render in the order you arranged them.

## Next

- [Chat hooks](./chat-hooks.md): manage chat state without preset components
- [Chat theming](./chat-theming.md): customize chat features and visuals

## Related

- [Chat UI](./chat-ui.md): preset chat component
- [`veryfront/chat`](../reference/veryfront/chat.md): chat reference
