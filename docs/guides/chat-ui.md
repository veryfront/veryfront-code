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
import { MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "./markdown-renderer.tsx";

export default function ChatPage() {
  const chat = useChat();
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat chat={chat} placeholder="Ask me anything..." />
    </MarkdownRendererProvider>
  );
}
```

`useChat()` connects to `/api/ag-ui` by default. `Chat` renders the composer,
message list, loading state, and scroll behavior.

The `MarkdownRendererProvider` wrapper is required for readable answers.
Assistants reply in Markdown, and `veryfront/markdown` presents plain escaped
source until a renderer is installed, so a `<Chat>` without one shows
`## Heading` rather than a heading. The chat starters scaffold the
`app/markdown-renderer.tsx` this sample imports; the `minimal` and
`agentic-workflow` templates do not. Create the file first if your project does
not already have it. See
[Render Markdown in chat](#render-markdown-in-chat). Wrap the other samples on
this page the same way.

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

GET requests without an upload ID do not list stored uploads by default. If
every authorized caller can access every upload in the storage backend, set
`allowListing: true` to support a shared uploads list. Do not enable listing
when authorization only proves that the caller belongs to the application.

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
      <Chat.If condition={(ctx) => ctx.isEmpty}>
        <Chat.Empty
          title="What can I help with?"
          suggestions={["Explain React hooks", "Write a regex"]}
          onSuggestionSelect={(suggestion) => chat.setInput(suggestion.prompt)}
        />
      </Chat.If>
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
    </Chat.Root>
  );
}
```

`<Chat.Empty>` renders whatever it is given; it does not hide itself. The preset
`<Chat>` decides when to show its empty state for you, but a custom layout owns
that decision, so gate the empty state on the thread being empty. `<Chat.If>`
reads the nearest `<Chat.Root>`, where `ctx.isEmpty` is true only while
`messages` is empty. Without the gate, the empty state stays mounted below the
conversation once the first message is sent.

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

## Render Markdown in chat

`veryfront/markdown` presents plain escaped source until a renderer is
installed, so `<Chat>` shows raw Markdown on its own. Every chat starter
scaffolds a renderer in `app/markdown-renderer.tsx` and installs it around
`<Chat>`, so a new project renders assistant answers with no extra setup.

Add the same two pieces to a project without one. Install the parser, pinned to
an exact version: these packages reach the browser through the module pipeline,
where a floating `^` range resolves to whatever is latest at request time.

```bash
npm install --save-exact react-markdown@9.0.3 remark-gfm@4.0.1
```

Then create the renderer and install it for the chat subtree:

```tsx
// app/markdown-renderer.tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MarkdownRendererProps } from "veryfront/markdown";

const LINK_REL = "noopener noreferrer nofollow";

/** Allow http(s), mailto, and relative URLs; drop every other scheme. */
function sanitizeUrl(url: string): string {
  // Browsers ignore ASCII spaces and control characters while parsing a
  // scheme, so `java&#9;script:` and ` data:` navigate exactly like the bare
  // scheme does. Match against a copy with those characters removed so an
  // obfuscated scheme is recognised and dropped.
  const probe = Array.from(url)
    .filter((char) => char > " " && char !== "\u007f")
    .join("");
  if (/^(https?|mailto):/i.test(probe)) return url;
  return /^[a-z][a-z0-9+.-]*:/i.test(probe) ? "" : url;
}

export function MarkdownRenderer({ source }: MarkdownRendererProps): React.JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      urlTransform={sanitizeUrl}
      components={{
        a: ({ href, children }) => (
          <a href={href || undefined} target="_blank" rel={LINK_REL}>
            {children}
          </a>
        ),
        // Auto-loading images would let an injected answer beacon to arbitrary
        // hosts. Render inert text, not an anchor: Markdown allows a linked
        // image (`[![alt](src)](href)`), and an anchor here would nest inside
        // that link, which is invalid HTML and breaks hydration.
        img: ({ src, alt }) => (
          <span title={typeof src === "string" ? src : undefined}>{alt || "image"}</span>
        ),
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
```

Assistant answers are untrusted input: a prompt-injected or retrieved document
can plant Markdown images and links that point at attacker-controlled URLs. The
URL policy above keeps only http(s), mailto, and relative URLs, renders images
as inert text instead of auto-loading remote beacons, and opens links in a new
tab without leaking the opener or referrer. Keep an equivalent policy in any
renderer you swap in.

```tsx
// app/page.tsx
"use client";
import { Chat } from "veryfront/chat";
import { MarkdownRendererProvider } from "veryfront/markdown";
import { MarkdownRenderer } from "./markdown-renderer.tsx";

export default function ChatPage() {
  return (
    <MarkdownRendererProvider renderer={MarkdownRenderer}>
      <Chat agentId="assistant" />
    </MarkdownRendererProvider>
  );
}
```

The provider covers assistant answers and reasoning. Chat applies its own prose
styling around whatever the renderer returns, so lists, headings, and inline
code match the rest of the chat surface. Pin the parser to an exact version:
these packages reach the browser through the module pipeline, where a floating
range resolves to whatever is latest at request time.

Your renderer owns parsing, sanitization, and link policy. To add syntax
highlighting, tables, or math, extend it with the remark and rehype plugins you
want rather than changing anything in chat.

## Present Markdown source safely

`veryfront/markdown` is the dependency-free Markdown boundary used by chat
surfaces. Without an installed rich renderer, it preserves the exact source in
an escaped `<pre><code>` element. This is useful when source visibility matters
more than semantic formatting:

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

The default does not claim that CommonMark, GFM, highlighting, or diagrams were
rendered. It emits no Markdown-authored links, images, or raw HTML, and the
escaped source is present in server HTML.

### Install a semantic renderer

Semantic Markdown is an explicit extension capability. Select a trusted
extension or application adapter that implements `MarkdownRendererProps`, then
install its component for the relevant subtree. In this example,
`ProjectMarkdownRenderer` comes from that adapter:

```tsx
import { Markdown, MarkdownRendererProvider } from "veryfront/markdown";
import { ProjectMarkdownRenderer } from "./project-markdown-renderer.tsx";

export default function Result() {
  return (
    <MarkdownRendererProvider renderer={ProjectMarkdownRenderer}>
      <Markdown>{answer}</Markdown>
    </MarkdownRendererProvider>
  );
}
```

The per-instance `renderer` prop takes precedence over the provider. Pass
`renderer={null}` when a nested surface must display plain source even though
an ancestor installed a renderer.

Parser-dependent options are forwarded only after a renderer has been selected.
For example, replace fenced-code rendering without changing the renderer used
for the rest of the document:

```tsx
<MarkdownRendererProvider renderer={ProjectMarkdownRenderer}>
  <Markdown
    renderCodeBlock={({ language, code }) => (
      <pre data-language={language}>
        <code>{code}</code>
      </pre>
    )}
  >
    {answer}
  </Markdown>
</MarkdownRendererProvider>;
```

Use `components` to pass framework-neutral element overrides to the selected
renderer:

```tsx
<MarkdownRendererProvider renderer={ProjectMarkdownRenderer}>
  <Markdown
    components={{
      a: ({ href, children }) => <a href={href}>{children}</a>,
    }}
  >
    {"Review the [Markdown section](#present-markdown-source-safely)."}
  </Markdown>
</MarkdownRendererProvider>;
```

The extension owns parsing, sanitization, unsafe link protocols, image policy,
highlighting, and diagram security. Configure parser-specific `remarkPlugins`
or `rehypePlugins` on that extension, not on core `Markdown`; removed or unknown
core props are rejected instead of ignored. Renderer failures propagate, so
handle them with an application error boundary when recovery is required.
Never derive plugin lists from untrusted input, and bound untrusted source size
before rendering.

## Verify it worked

Run `veryfront dev` and open the page that renders the chat UI:

- The composer renders and accepts input.
- A submitted message streams tokens from `/api/ag-ui`.
- The preset renders its default controls.
- Custom layouts keep the message list and composer wired to the same AG-UI
  stream.
- In a custom layout, the empty state disappears after the first message is
  sent and does not reappear below the conversation.
- A persisted conversation remains in the sidebar after a page reload.
- A conversation persistence failure renders an alert with the failed
  operation.
- A chat using `memoryConversationStore()` starts empty after a page reload.
- Standalone Markdown source is escaped and readable in the initial server
  HTML; an injected renderer is used only in the subtree where it is installed.
- An assistant answer containing a list or a heading renders as formatted
  Markdown, not raw Markdown source, and the browser console reports no
  missing-Markdown-renderer warning.

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
