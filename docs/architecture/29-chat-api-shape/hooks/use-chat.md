# useChat

The base chat session hook — messages, status, streaming state, and session actions. Input state is *not* here (it lives in `useChatInput`).

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChat } from 'veryfront/chat'
```

## Signature

```ts
function useChat<TMessage extends ChatMessage = ChatMessage>(
  options: UseChatOptions
): UseChatResult<TMessage>

interface UseChatOptions {
  /** Endpoint string, or a transport object — auth works on day one without a custom client. */
  api: string | { url: string; headers?: …; credentials?: …; fetch?: …; body?: … }
  // Further options: TBD in implementation.
}

interface UseChatResult<TMessage> {
  // State
  messages: TMessage[]            // per-message `status` / `error` live on the message object
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  error: …                        // session-level error
  streamingMessageId: …           // id of the message currently streaming

  // Actions
  sendMessage: …
  stop: …
  reload: (messageId?: string) => …   // regenerate; optionally from a specific message
  setModel: …
  editMessage: …
  setMessages: …
  getBranches: …                  // existing; surfaced via useMessageBranches
  switchBranch: …                 // existing; surfaced via useMessageBranches
}
```

`…` = the RFC names these members but does not pin their types; TBD in implementation.

Messages are typed `ChatMessage<TMetadata, TDataParts, TTools>` (AI SDK v5 `UIMessage` shape); `useChat<TMessage>` preserves the type through `useMessageParts`, `Message.Parts`' render prop, and helpers.

## Options

| Option | Type | Description |
| --- | --- | --- |
| `api` | `string \| { url, headers, credentials, fetch, body }` | Endpoint or transport object |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `messages` | `TMessage[]` | The transcript; **per-message `status`/`error` on the message object** |
| `status` | `'ready' \| 'submitted' \| 'streaming' \| 'error'` | Session status — mirrored as `data-status` on `ChatRoot` / `ChatInput.Root` / `ChatInput.Submit` |
| `error` | TBD | Session-level error |
| `streamingMessageId` | TBD | Which message is streaming now |

### Actions

| Name | Description |
| --- | --- |
| `sendMessage` | Send a message |
| `stop` | Abort the in-flight response |
| `reload(messageId?)` | Regenerate — optionally from a specific message |
| `setModel` | Switch model |
| `editMessage` | Edit a message (the composer inside a `Message` is the edit form) |
| `setMessages` | Replace the transcript (e.g. thread-level clear) |
| `getBranches` / `switchBranch` | Message branching (existing API, kept) — see `useMessageBranches` |

### Prop getters

None — `useChat` owns session state, not interactive nodes. Getters live on the hooks that own elements ([`useChatInput`](#), [`useChatScroll`](./use-chat-scroll.md), …).

### Not here (by design)

- **No `input` / `setInput` / `handleInputChange`** — input state has one owner, `useChatInput` (breaking-changes ledger).
- **Streams are provider-scoped, not mount-scoped:** keyed by conversation id in the conversations/chat context; switching threads neither aborts nor orphans an in-flight stream, and it persists to the correct thread. Use [`useConversationChat`](./use-conversation-chat.md) for thread binding.

## Example

```tsx
function MyChat() {
  const chat = useChat({ api: '/api/ag-ui' })
  const chatInput = useChatInput({ chat })

  return (
    <div>
      <div role="log" aria-relevant="additions" aria-busy={chat.status === 'streaming'}>
        {chat.messages.map((m) => (
          <article key={m.id} data-role={m.role}>{getTextContent(m)}</article>
        ))}
      </div>
      <form {...chatInput.getFormProps()}>
        <textarea {...chatInput.getFieldProps()} />
        <button {...chatInput.getSubmitProps()}>
          {chatInput.isStreaming ? 'Stop' : 'Send'}
        </button>
      </form>
    </div>
  )
}
```

## Used by

- [`Chat`](../components/chat.md) (runs it internally at L1)
- [`ChatRoot`](../components/chat-root.md) (`chat={useChat()}` is the shared context)
- [`ChatMessageList`](../components/chat-message-list.md) · `ChatInput` · `Message` (consume via context or explicit `chat` prop)

## Related

- [`useConversationChat`](./use-conversation-chat.md) — `useChat` bound to the active conversation
- [`useChatContext`](./use-chat-context.md) — read the shared session from `ChatRoot`
- [`useCompletion`](./use-completion.md) · [`useStreaming`](./use-streaming.md)
