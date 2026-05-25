---
title: "Build a chat UI"
description: "Add a preset or custom chat interface with the Veryfront chat components."
order: 22
---

Use this guide to add a chat interface to an AG-UI route. Start with the preset
`Chat` component. Move to composition only when you need layout control.

For headless state, see [Chat hooks](./chat-hooks.md).

## Prerequisites

- A Veryfront project with an AG-UI route, such as `/api/ag-ui` (see
  [Create agent](../getting-started/create-agent.md)).
- A configured provider for the route's agent (see [Providers](./providers.md)).

## Add the preset UI

Create a client page:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function ChatPage() {
  const chat = useChat();
  return <Chat {...chat} placeholder="Ask me anything..." />;
}
```

`useChat()` connects to `/api/ag-ui` by default. `Chat` renders the composer,
message list, loading state, and scroll behavior.

## Add request preprocessing

Use `beforeStream` when the route needs to add context, enforce authorization,
or stop a request before the agent runs:

```ts
// app/api/ag-ui/route.ts
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

Veryfront wraps untrusted system-role messages returned from `beforeStream`
before they reach the agent. Retrieved documents are treated as reference data,
not instructions.

## Customize the preset

Pass props to enable common chat features:

```tsx
<Chat
  {...chat}
  placeholder="Ask about your project"
  suggestions={["Summarize this repo", "Find deployment risks"]}
  onSuggestionClick={(value) => chat.setInput(value)}
  showSources
  showMessageActions
  theme={{
    colors: {
      primary: "#2563eb",
      background: "#ffffff",
    },
  }}
  models={[
    { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet" },
    { value: "openai/gpt-4o", label: "GPT-4o" },
  ]}
  model={chat.model}
  onModelChange={chat.setModel}
/>;
```

For attachments, keep upload handling in your app:

```tsx
<Chat
  {...chat}
  onAttach={(files) => uploadFiles(files)}
  attachAccept=".pdf,.docx,.txt"
  attachments={uploadedFiles}
  onRemoveAttachment={(id) => removeFile(id)}
/>;
```

## Compose a custom layout

Use the composition components when the preset layout is too constrained:

```tsx
// app/page.tsx
"use client";
import { Chat, useChat } from "veryfront/chat";

export default function CustomLayout() {
  const chat = useChat();

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
      <Chat.Empty
        title="What can I help with?"
        suggestions={["Explain React hooks", "Write a regex"]}
        onSuggestionClick={(value) => chat.setInput(value)}
      />
    </Chat.Root>
  );
}
```

Use `Message` when individual message rendering needs custom structure:

```tsx
import { Message } from "veryfront/chat";

<Message.Root message={message}>
  <Message.Avatar />
  <Message.Content />
  <Message.Actions />
</Message.Root>;
```

For thread navigation, use `ChatWithSidebar`:

```tsx
import { ChatWithSidebar, useChat } from "veryfront/chat";

function App() {
  const chat = useChat();
  return <ChatWithSidebar chat={chat} sidebar={{ storageKey: "my-app" }} />;
}
```

Use chat context providers only when nested components need direct state access.
Prefer preset props or composition components first.

## Verify it worked

Run `veryfront dev` and open the page that renders the chat UI:

- The composer renders and accepts input.
- A submitted message streams tokens from `/api/ag-ui`.
- Preset props render the expected controls.
- Custom layouts keep the message list and composer wired to the same AG-UI
  stream.

If the assistant response is empty, check the dev-server log for provider or
agent errors and confirm the AG-UI route is mounted.

## Next

- [Chat hooks](./chat-hooks.md): Use headless chat state
- [Memory and streaming](./memory-and-streaming.md): Configure agent memory and streaming

## Related

- [veryfront/chat](../api-reference/veryfront/chat.md): Chat components and hooks
- [veryfront/agent](../api-reference/veryfront/agent.md): Agent route helpers
