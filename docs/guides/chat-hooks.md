---
title: "Chat hooks"
description: "Use headless chat, agent, completion, voice, and thread hooks."
order: 24
---

Headless hooks expose the chat runtime without the preset UI.

Use:

- `useChat` for AG-UI streaming chat
- `useAgent` for direct agent invocation
- `useCompletion` for one-shot text generation

Use these hooks when you want full control of the layout.

Examples below assume an AG-UI endpoint at `/api/ag-ui`. Use the route from [Chat UI](./chat-ui.md) or [Agents](./agents.md), run `veryfront dev`, then open the page that renders the hook.

## Prerequisites

- A page that can render React client components.
- An AG-UI route mounted at `/api/ag-ui` (or another path you pass via `api`).
- For `useCompletion`, an API route that returns plain text or SSE for the
  `complete` call.

## useChat

```tsx
"use client";
import { useChat } from "veryfront/chat";

export default function ChatState() {
  const chat = useChat();

  return (
    <form onSubmit={chat.handleSubmit}>
      <input value={chat.input} onChange={chat.handleInputChange} />
      <button disabled={chat.isLoading}>Send</button>
    </form>
  );
}
```

`useChat` exposes messages, input state, submit handlers, stop/reload handlers, model state, branch helpers, and inference status. It uses AG-UI for Veryfront AG-UI routes created with `createAgUiHandler`.

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

## Manage conversations

Use `useConversations` when you need a conversation list, active selection, and
persistence without the preset sidebar. Handle every persistence failure
through `onError`, and map `ConversationStoreError.operation` to user-facing
copy:

```tsx
"use client";

import { useState } from "react";
import { type ConversationStoreError, useConversations } from "veryfront/chat";

const PERSISTENCE_MESSAGES: Record<
  ConversationStoreError["operation"],
  string
> = {
  list: "Could not load the conversation list.",
  load: "Could not load that conversation.",
  save: "Could not save the latest conversation changes.",
  delete: "Could not delete that conversation.",
  subscribe: "Live conversation updates stopped.",
};

export default function ConversationList() {
  const [notice, setNotice] = useState<string | null>(null);
  const conversations = useConversations({
    storageKey: "support-chat",
    onError(error) {
      setNotice(PERSISTENCE_MESSAGES[error.operation]);
    },
  });

  return (
    <section>
      <h2>Conversations</h2>
      {conversations.isLoading && <p>Loading...</p>}
      {conversations.error && notice && (
        <div role="alert">
          <p>{notice}</p>
          <button
            type="button"
            onClick={() => {
              conversations.clearError();
              setNotice(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <ul>
        {conversations.conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              type="button"
              aria-current={conversations.activeConversationId === conversation.id
                ? "page"
                : undefined}
              onClick={() => conversations.select(conversation.id)}
            >
              {conversation.title}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={Boolean(conversations.error)}
        onClick={() => conversations.create("assistant")}
      >
        New conversation
      </button>
    </section>
  );
}
```

A failed save remains visible in the current React tree. Treat it as
unsaved until the adapter completes a later save.
Deletion is confirm-on-success in the React tree: the conversation remains
visible while the adapter is deleting it. A delete rejected before its durable
intent is stored leaves the record unchanged. Once that intent is durable,
recovery always finishes the deletion; the original storage error is still
reported, and the next locked operation retries any unfinished work.
After deletion succeeds, ordinary `save()` calls for that id remain suppressed
until a later list confirms its absence, preventing late stream callbacks from
resurrecting it. To intentionally reuse the deleted id when that confirmation
cannot complete, call
`conversations.save(replacement, { recreateDeleted: true })` explicitly.

`conversations.isLoading` covers only the initial summary-list request. Use
`conversations.isActiveConversationLoading` when the selected conversation's
full record is being fetched. If that request fails,
`activeConversationError` identifies the exact conversation id; call
`reloadActiveConversation()` to retry it through the same provider-owned
store.

## Load one conversation

Use `useConversation` to load a full conversation without mounting the list
hook:

```tsx
"use client";

import { useConversation } from "veryfront/chat";

export default function ConversationPreview({ id }: { id: string }) {
  const {
    conversation,
    isLoading,
    error,
    clearError,
    reload,
  } = useConversation(id, { storageKey: "support-chat" });

  if (isLoading) return <p>Loading conversation...</p>;
  if (error) {
    return (
      <div role="alert">
        <p>Could not load the conversation.</p>
        <button
          type="button"
          onClick={() => {
            clearError();
            reload();
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!conversation) return <p>Conversation not found.</p>;

  return (
    <article>
      <h2>{conversation.title}</h2>
      <p>{conversation.messages.length} messages</p>
    </article>
  );
}
```

After the loading and error branches above, `null` means the conversation does
not exist. Read or decode failures populate `error` with a
`ConversationStoreError` whose operation is `load`.

Inside a `ConversationsProvider`, `useConversation(id)` reuses the provider
when `id` is active. Its loading state, load error, `clearError()`, and
`reload()` all remain attached to the provider's store; an omitted or different
local `storageKey` is never consulted for that provider-owned id.

## Choose conversation persistence

Omitting `store` from either conversation hook uses
`localConversationStore(storageKey)`.

### Use local browser storage

Serve production pages from a secure browser context. The browser must provide
the Web Locks API. The local adapter takes one exclusive lock for the logical
store so cooperating same-origin tabs cannot overwrite the shared conversation
index. If Web Locks are unavailable or inaccessible, the operation rejects
before it touches storage. There is no unlocked fallback.

Use the local adapter only when your data fits these maxima:

- 2 MiB per serialized index and 4 MiB per serialized conversation
- 1,000 conversations per store, 1,000 messages per conversation, and 1,000
  parts per message
- 1 KiB per identifier or storage-key component and 16 KiB per title
- 4 MiB per JSON string, nesting depth 64, 65,536 JSON nodes, and 10,000 entries
  per object or array

Size limits use UTF-8 bytes. Unavailable, blocked, corrupt, quota-limited,
or out-of-bounds storage rejects instead of returning a successful result.
Use the exported `CONVERSATION_STORAGE_LIMITS` object when application code
needs to inspect the same maxima before saving. Browser quota can be lower than
these codec limits. A save also needs temporary space for its bounded rollback
journal; a quota rejection leaves the prior record recoverable.

Every successful local save keeps a fixed-size idle reservation in the logical
store's control slot. A current-format delete replaces that reservation with a
no-larger compact intent before removing data, so it can start without growing
the store at quota. Records written before this reservation protocol may still
need free space to establish it. Deleting a legacy record may also need room for
the current-format index tombstone used to suppress ambiguous legacy keys.

Conversation metadata, message metadata, tool input/output, and data parts must
be JSON-safe plain data. The adapter rejects `undefined`, bigint, symbols,
functions, non-finite numbers, negative zero, cyclic structures, accessors,
and objects with custom prototypes instead of silently changing them during
serialization. A `Date` is accepted only for `message.createdAt` and is stored
as an ISO string.

The adapter reads the legacy unversioned layout and migrates records on write.
Deleting a legacy record also removes its old blob when the decoded id proves
ownership. A malformed or cross-namespace legacy key cannot be attributed
safely, so deletion writes a current-format tombstone without deleting those
ambiguous bytes.

Treat this storage-format change as a coordinated rollout. Once a
current-format index is written, it is authoritative for that logical store;
older open tabs that continue writing legacy keys no longer update the view
seen by the new version, and an older rollback build does not understand the
new records. Require a reload or close older tabs before migration, and do not
roll back without an explicit data migration or export path.

### Use memory for ephemeral sessions

Pass a stable `memoryConversationStore()` instance for SSR, tests, demos, or
sensitive sessions whose transcript must not enter Web Storage. Create it per
component tree with `useState`, as shown in
[Keep conversations ephemeral](./chat-ui.md#keep-conversations-ephemeral).
The store does not survive a reload. Seed records are snapshotted at
construction and every seed id must be unique. Uncloneable seeds and duplicate
ids throw instead of being retained or overwritten. Unlike the local-storage
adapter, the in-memory adapter does not apply the durable storage codec at this
trusted, typed boundary.

### Use a custom durable store

Implement `ConversationStore` with IndexedDB transactions when you need
stronger browser crash-atomic and multi-tab guarantees. Use an authenticated
API-backed store when conversations must follow a user across devices or need
server-side authorization, conflict handling, retention, or backups.

Pass the custom adapter through `store` and keep its object identity stable for
the mounted hook. `list`, `load`, `save`, and `delete` must return rejected
promises when they cannot complete. Implement `subscribe` only when the adapter
delivers out-of-band changes. It must throw when setup fails and return an
unsubscribe function after setup succeeds.

`save` must not resolve until a later `list` or `load` through the same store
instance can observe the accepted record. Those reads are authoritative and
may contain server-normalized titles, counts, or timestamps.

The hook calls that unsubscribe function when its subscription scope ends. It
never calls an injected store's optional `dispose`, including on replacement or
unmount. The caller owns the store and must dispose it only after the final
consumer and any pending operations have finished.

Web Locks coordinate cooperating local writers. Before changing the
conversation blob and shared index, the local adapter records either a bounded
save before-image or a compact delete intent. The next locked operation rolls an
interrupted save back or finishes an interrupted delete before exposing stored
data. Recovery is fail-closed: a malformed control value or an unresolved
storage failure rejects the operation and retains its recovery state for retry.

Web Storage still does not provide a native multi-key transaction and cannot
coordinate old tabs or other writers that do not take the same lock. Concurrent
saves to the same conversation remain last-writer-wins, and a stale tab can save
after another tab deletes the conversation. Use IndexedDB or a durable custom
store with revisions, compare-and-set writes, and durable tombstones when the
application must prevent stale overwrites or deletion resurrection.

## Composition hooks

When you compose the chat UI yourself (see [UI + chat](./chat-ui.md)), these
hooks expose the state behind the components. Context-backed hooks must be used
inside their matching provider (`<ChatInput>` / `<Message>` / `<Chat>`), while
`useChatScroll` is standalone and can be used with any scroll container.

### useChatInput

The headless composer. Reads the enclosing `<ChatInput>` context and returns the
input state plus prop-getters you spread onto your own elements. The getters
merge your handlers/classes with the internal ones:

```tsx
"use client";

import { useState } from "react";
import { ChatInput, useChatInput } from "veryfront/chat";

function Fields() {
  const input = useChatInput();
  return (
    <form {...input.getFormProps()}>
      <textarea {...input.getFieldProps()} placeholder="Message…" />
      <button {...input.getSubmitProps()}>Send</button>
    </form>
  );
}

export function CustomComposer({
  onSend,
}: {
  onSend: (message: { text: string }) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <ChatInput.Root
      input={value}
      onChange={(event) => setValue(event.currentTarget.value)}
      sendMessage={onSend}
      setInput={setValue}
    >
      <Fields />
    </ChatInput.Root>
  );
}
```

Getters: `getFormProps`, `getFieldProps` (for a textarea), `getSubmitProps`, `getAttachProps`,
`getVoiceProps`. State: `input`, `canSubmit`, `canAttach`, `isLoading`, `isListening`,
`canUseVoice`, `attachments`, `model`. Use `canAttach` and `canUseVoice` to omit custom
controls when their corresponding capability is not configured. Their prop getters also
return fail-closed `disabled` state so unavailable controls cannot be re-enabled accidentally.
`mergeProps` is exported for composing several getters onto one element. The preset
`<Chat>` wires `setInput` automatically; direct `<ChatInput>` or `<ChatInput.Root>`
providers must receive `setInput` before a headless child calls `input.setInput(...)`.

### useChatScroll

Stick-to-bottom scroll management for a message list. Attach `scrollRef` to the
viewport and `contentRef` to the growing content; the hook keeps the user pinned
to the bottom while streaming:

```tsx
"use client";

import { type ChatMessage, Message, useChatScroll } from "veryfront/chat";

export default function CustomTranscript(
  { messages }: { messages: ChatMessage[] },
) {
  const scroll = useChatScroll<HTMLDivElement>(messages.length);

  return (
    <div ref={scroll.scrollRef} className="overflow-y-auto">
      <div ref={scroll.contentRef}>
        {messages.map((message) => <Message key={message.id} message={message} />)}
      </div>
    </div>
  );
}
```

Also: `viewportRef`, `isAtBottom`, `scrollToBottom`/`scrollToEnd`, `scrollToStart`,
`scrollToMessage(id)`, and `getViewportProps()`.

### useMessageBranches

The regeneration/edit variants of a message (what `BranchPicker` shows). Must be
used inside a `<Message>`:

```tsx
"use client";

import { type ChatMessage, Message, useMessageBranches } from "veryfront/chat";

function BranchButtons() {
  const branches = useMessageBranches();
  return (
    <nav aria-label="Message variants">
      <button disabled={!branches.hasPrevious} onClick={branches.previous}>
        Previous
      </button>
      <span>{branches.index + 1} / {branches.count}</span>
      <button disabled={!branches.hasNext} onClick={branches.next}>
        Next
      </button>
    </nav>
  );
}

export function BranchedMessage({ message }: { message: ChatMessage }) {
  return (
    <Message.Root message={message}>
      <Message.Content />
      <BranchButtons />
    </Message.Root>
  );
}
```

## Inference mode

`useChat` exposes `inferenceMode` so your UI can show whether inference is running through cloud, server-local, or browser runtime.

## Verify it worked

Render the hook in a page and exercise the surface you care about:

- `useChat`: submit a message. `chat.messages` should grow and `isLoading`
  should flip while the response streams.
- `useAgent`: call `invoke`. `status` should move through `running` to
  `idle` and `messages` should contain the agent's reply.
- `useCompletion`: call `complete`. `completion` should populate and
  `isLoading` should flip back to `false` when the response ends.
- `useConversations`: create and rename a conversation, then reload. Ensure the
  local adapter restores the title. If an adapter rejects, ensure the alert
  identifies the operation and the UI does not claim the change is durable.
- `useConversation`: select a stored id. Ensure the hook returns the full
  conversation. Select **Try again** after a rejected load and confirm that
  `reload` starts another request.
- `memoryConversationStore`: reload the page and confirm the conversation is
  gone.

If `isLoading` never flips back, check the network tab for the request to
your API and the dev-server log for handler errors.
