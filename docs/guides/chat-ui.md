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
  return <Chat chat={chat} placeholder="Ask me anything..." />;
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

Configure the preset's content, theme, and agent options. The preset always
includes sources, multi-step rendering, message actions, scroll-to-bottom, and
attachments:

```tsx
<Chat
  chat={chat}
  placeholder="Ask about your project"
  suggestions={["Summarize this repo", "Find deployment risks"]}
  onSuggestionSelect={(suggestion) => chat.setInput(suggestion.prompt)}
  theme={{
    container: "bg-white text-slate-950",
    message: {
      user: "rounded-lg bg-blue-600 px-4 py-3 text-white",
    },
  }}
  agent={{
    models: [
      { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet" },
      { value: "openai/gpt-4o", label: "GPT-4o" },
    ],
  }}
/>;
```

For durable attachments, mount the upload handler behind your app's auth and
point `Chat` at that route:

```ts
// app/api/uploads/route.ts
import { createChatUploadHandler } from "veryfront/chat/uploads";
import { authorizeSession } from "@/lib/auth";

export const { POST, GET, DELETE } = createChatUploadHandler({
  // Verify a signed same-origin session cookie. <Chat> does not expose secret
  // bearer credentials to browser code.
  authorize: (request) => authorizeSession(request),
});
```

The authorization callback must return literal `true` to permit a request.
`false` and invalid runtime results such as `undefined` are denied.
The preset sends same-origin cookies automatically. If your route instead
requires an explicit bearer header, compose the headless `useUpload()` hook
with its `headers` option rather than placing a secret token in `Chat` props.

To change the upload limits, bound the complete multipart request separately
from the file bytes:

```ts
export const { POST, GET, DELETE } = createChatUploadHandler({
  authorize,
  maxFileSize: 25 * 1024 * 1024,
  maxBodySize: 25 * 1024 * 1024 + 64 * 1024,
});
```

```tsx
<Chat
  chat={chat}
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
    <Chat.Root
      messages={chat.messages}
      input={chat.input}
      setInput={chat.setInput}
      onSubmit={chat.handleSubmit}
      onStop={chat.stop}
      onReload={chat.reload}
    >
      <header className="border-b p-4">
        <h1>Assistant</h1>
      </header>
      <Chat.MessageList messages={chat.messages} />
      <Chat.Input.Root
        input={chat.input}
        onChange={chat.handleInputChange}
        onSubmit={chat.handleSubmit}
        stop={chat.stop}
      >
        <Chat.Input.Field placeholder="Ask me anything..." />
        <Chat.Input.Toolbar>
          <Chat.Input.Export messages={chat.messages} />
          <Chat.Input.Send />
        </Chat.Input.Toolbar>
      </Chat.Input.Root>
      <Chat.Empty
        title="What can I help with?"
        suggestions={["Explain React hooks", "Write a regex"]}
        onSuggestionSelect={(suggestion) => chat.setInput(suggestion.prompt)}
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
  <Message.Sources />
  <Message.Actions />
</Message.Root>;
```

## Theming and the token scope

The chat and `veryfront/ui` primitives resolve their `var(--token)` styles
against a **scoped** design-token stylesheet, so the tokens never leak to the
rest of your page. The canonical scope attribute is **`data-vf-ui`**;
`data-vf-chat` is kept as a **compatibility alias** (both are set on every scope
element, and every token rule matches both), so existing selectors keep working.

`<Chat>` establishes the scope for itself. When you compose the primitives
_around_ `<Chat>`, such as a sidebar, header, or uploads panel in your own
shell, wrap that shell in one `ChatThemeScope` so everything inside it is themed:

```tsx
import { ChatThemeScope } from "veryfront/chat";

<ChatThemeScope className="h-screen">
  <AppShell>{/* sidebar + <Chat /> + panels */}</AppShell>
</ChatThemeScope>;
```

If you target the scope from your own CSS or DOM queries, prefer `[data-vf-ui]`.
`[data-vf-chat]` remains supported and will only be removed in a future major
release.

## Add conversation navigation

Wrap the chat and sidebar in a `ConversationsProvider`.
The provider owns the conversation list and persistence; `<ChatSidebar>` and
`<Chat>` both read it from context, so neither needs wiring:

```tsx
"use client";

import { useState } from "react";
import {
  Chat,
  ChatSidebar,
  ConversationsProvider,
  type ConversationStoreError,
} from "veryfront/chat";

export default function ChatApp() {
  const [persistenceError, setPersistenceError] = useState<ConversationStoreError | null>(null);

  return (
    <ConversationsProvider
      storageKey="my-app"
      onError={(error) => setPersistenceError(error)}
    >
      <main>
        {persistenceError && (
          <div role="alert">
            <p>
              Conversation storage {persistenceError.operation}{" "}
              failed. Do not treat the current view as durable until this operation succeeds.
            </p>
            <button
              type="button"
              onClick={() => setPersistenceError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
        <div style={{ display: "flex" }}>
          <ChatSidebar />
          <Chat agentId="assistant" />
        </div>
      </main>
    </ConversationsProvider>
  );
}
```

The default local adapter fails closed. Unavailable, blocked, corrupt, full, or
out-of-bounds storage reports a `ConversationStoreError`; it does not pretend
the operation succeeded or silently switch to memory. The error's `operation`
is `list`, `load`, `save`, `delete`, or `subscribe`.

### Keep conversations ephemeral

Use `memoryConversationStore()` for SSR, short-lived demos, or sensitive
sessions whose transcript must not be written to browser storage. Create the
store once per mounted tree:

```tsx
// app/private-chat/page.tsx
"use client";

import { useState } from "react";
import { Chat, ChatSidebar, ConversationsProvider, memoryConversationStore } from "veryfront/chat";

export default function PrivateChat() {
  const [store] = useState(() => memoryConversationStore());

  return (
    <ConversationsProvider store={store}>
      <main style={{ display: "flex" }}>
        <ChatSidebar />
        <Chat agentId="assistant" />
      </main>
    </ConversationsProvider>
  );
}
```

The memory store is cleared when the tree is discarded or the page reloads.
Do not create a module-level memory store in server-rendered code, because
different requests would share the same store.

Use chat context providers only when nested components need direct state access.
Prefer preset props or composition components first.

## Render Markdown directly

Use `veryfront/markdown` when a page or custom message surface needs the same
renderer without the rest of the chat composition:

````tsx
import { Markdown } from "veryfront/markdown";

const answer = [
  "# Deployment result",
  "",
  "| Check | Result |",
  "| --- | --- |",
  "| Tests | Passed |",
  "",
  "```ts",
  "const release = await deploy();",
  "```",
].join("\n");

export default function Result() {
  return <Markdown>{answer}</Markdown>;
}
````

CommonMark and GitHub Flavored Markdown, including tables, task lists, and
strikethrough, are server-rendered. Fenced source is also present in the server
HTML. Shiki highlighting and Mermaid SVG rendering are browser enhancements;
if either enhancement cannot load or render, the source remains readable.

Replace fenced-code rendering without changing inline code:

```tsx
<Markdown
  renderCodeBlock={({ language, code }) => (
    <pre data-language={language}>
      <code>{code}</code>
    </pre>
  )}
>
  {answer}
</Markdown>;
```

Use `components` to replace an HTML element renderer. Consumer entries win
over the built-in link, table, cell, blockquote, and code-fence renderers:

```tsx
<Markdown
  components={{
    a: ({ href, children }) => <a href={href}>{children}</a>,
  }}
>
  {"Review the [Markdown section](#render-markdown-directly)."}
</Markdown>;
```

Raw HTML and unsafe link protocols are not emitted by the default pipeline.
`remarkPlugins`, `rehypePlugins`, and custom components execute as trusted
application code and can change those guarantees; never build plugin lists
from untrusted input. Remote Markdown images can initiate browser requests, so
override the `img` component when untrusted content needs a stricter image or
privacy policy. Bound untrusted Markdown size before rendering when the
application accepts arbitrarily large documents.

## Verify it worked

Run `veryfront dev` and open the page that renders the chat UI:

- The composer renders and accepts input.
- A submitted message streams tokens from `/api/ag-ui`.
- The preset renders its default controls.
- Custom layouts keep the message list and composer wired to the same AG-UI
  stream.
- A persisted conversation remains in the sidebar after a page reload.
- A conversation persistence failure renders an alert with the failed
  operation.
- A chat using `memoryConversationStore()` starts empty after a page reload.
- Standalone Markdown is semantic in the initial server HTML, and fenced code
  remains readable before browser enhancement.

If the assistant response is empty, check the dev-server log for provider or
agent errors and confirm the AG-UI route is mounted.

## Next

- [Chat hooks](./chat-hooks.md): Use headless chat state
- [Memory and streaming](./memory-and-streaming.md): Configure agent memory and streaming

## Related

- [veryfront/chat](../api-reference/veryfront/chat.md): Chat components and hooks
- [veryfront/markdown](../api-reference/veryfront/markdown.md): Markdown props
  and renderer extension points
- [veryfront/agent](../api-reference/veryfront/agent.md): Agent route helpers
