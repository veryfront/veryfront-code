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

For durable attachments, mount the upload handler behind your app's auth and
point `Chat` at that route:

```ts
// app/api/uploads/route.ts
import { createChatUploadHandler } from "veryfront/chat/uploads";

function authorize(request: Request) {
  const token = Deno.env.get("UPLOAD_TOKEN");
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

export const { POST, GET, DELETE } = createChatUploadHandler({ authorize });
```

```tsx
<Chat
  {...chat}
  uploadApi="/api/uploads"
  attachAccept=".pdf,.docx,.txt"
/>;
```

For local prototypes or intentionally public upload routes, pass
`allowUnauthenticated: true` explicitly.

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
      <Chat.Input
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

## Migrate from older chat APIs

This release completes the chat API migration. Use the new conversation and
composition names instead of the older Thread and Composer exports:

| Older export                | Use instead                                           |
| --------------------------- | ----------------------------------------------------- |
| `ChatComposer`              | `ChatInput` or `Chat.Input`                           |
| `MessageActions`            | `MessageActionBar` or `Message.Actions`               |
| `UploadsPanel`              | `AttachmentsPanel`                                    |
| `StandaloneMessage`         | `Message`                                             |
| `StreamingMessage`          | `Message`                                             |
| `ChatWithSidebar`           | `ConversationsProvider` with `ChatSidebar` and `Chat` |
| `useThreads`                | `useConversations`                                    |
| `ThreadListContextProvider` | `ConversationsProvider`                               |

For conversation navigation, wrap the chat + sidebar in a `ConversationsProvider`.
The provider owns the conversation list and persistence; `<ChatSidebar>` and
`<Chat>` both read it from context, so neither needs wiring:

```tsx
import { Chat, ChatSidebar, ConversationsProvider } from "veryfront/chat";

function App() {
  return (
    <ConversationsProvider storageKey="my-app">
      <div style={{ display: "flex" }}>
        <ChatSidebar />
        <Chat agentId="assistant" />
      </div>
    </ConversationsProvider>
  );
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
