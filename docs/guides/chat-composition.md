---
title: "Chat composition"
description: "Build custom chat layouts with Chat and Message composition components."
order: 15
---

# Chat composition

Use composition when the preset `Chat` component is too constrained but you still want Veryfront to own the chat wiring.

The examples use the same `useChat({ api: "/api/chat" })` setup as the [Chat UI](./chat-ui.md) guide. Create the chat route first, then render these components in a client page and verify them with `veryfront dev`.

## Layout components

```tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function CustomLayout() {
  const chat = useChat({ api: "/api/chat" });

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
  const chat = useChat({ api: "/api/chat" });
  return (
    <ChatWithSidebar
      chat={chat}
      sidebar={{ storageKey: "my-app" }}
    />
  );
}
```

## Next

- [Chat hooks](./chat-hooks.md): manage chat state without preset components
- [Chat theming](./chat-theming.md): customize chat features and visuals

## Related

- [Chat UI](./chat-ui.md): preset chat component
- [`veryfront/chat`](../reference/chat.md): chat API reference
