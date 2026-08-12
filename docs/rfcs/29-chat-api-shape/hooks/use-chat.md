# useChat

The base chat session hook - messages, status, streaming state, and session actions. Input state is _not_ here (it lives in `useChatInput`).

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useChat`, `UseChatOptions`, `UseChatResult`
> - **Not exported today:** none
>
> The RFC's headline delta here is a **removal**, which no symbol list can express: `useChat` still owns `input` / `setInput` / `handleInputChange` on `main`, so it is not yet true that "input state has one owner". That removal is batched into the one breaking release.
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChat } from "veryfront/chat";
```

## Signature

```ts
function useChat<TMessage extends ChatMessage = ChatMessage>(
  options: UseChatOptions,
): UseChatResult<TMessage>;

interface UseChatOptions<TMessage extends ChatMessage = ChatMessage> {
  /** Endpoint string, or a transport object - auth works on day one without a custom client. */
  api: string | ChatTransport<TMessage>;
  id?: string;
  initialMessages?: TMessage[];
  model?: string;
  onError?: (error: Error) => void;
  onUpdate?: (messages: TMessage[]) => void;
}

interface ChatTransport<TMessage> {
  url: string;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  body?: Record<string, unknown> | ((input: { messages: TMessage[] }) => Record<string, unknown>);
}

interface UseChatResult<TMessage> {
  // State
  messages: TMessage[]; // per-message `status` / `error` live on the message object
  status: "ready" | "submitted" | "streaming" | "error";
  error: Error | null; // session-level error
  streamingMessageId: string | null; // id of the message currently streaming

  // Actions
  sendMessage: (
    input: string | {
      text?: string;
      parts?: ChatMessagePart[];
      metadata?: Partial<TMessage["metadata"]>;
    },
  ) => Promise<void>;
  stop: () => void;
  reload: (messageId?: string) => Promise<void>; // regenerate; optionally from a specific message
  setModel: (model: string) => void;
  editMessage: (
    messageId: string,
    input: string | { text?: string; parts?: ChatMessagePart[] },
  ) => Promise<void>;
  setMessages: (updater: TMessage[] | ((current: TMessage[]) => TMessage[])) => void;
  getBranches: (messageId: string) => BranchInfo[];
  switchBranch: (messageId: string, index: number) => void;
}
```

Messages are typed `ChatMessage<TMetadata, TDataParts, TTools>` (AI SDK v5 `UIMessage` shape); `useChat<TMessage>` preserves the type through `useMessageParts`, `Message.Parts`' render prop, and helpers.

## Options

| Option            | Type                                | Description                                                                   |
| ----------------- | ----------------------------------- | ----------------------------------------------------------------------------- |
| `api`             | `string \| ChatTransport<TMessage>` | Endpoint or transport object                                                  |
| `id`              | `string`                            | Stable session id; `useConversationChat` supplies the active conversation id. |
| `initialMessages` | `TMessage[]`                        | Initial transcript for standalone sessions.                                   |
| `model`           | `string`                            | Initial model id.                                                             |
| `onError`         | `(error: Error) => void`            | Called after the hook records a session error.                                |
| `onUpdate`        | `(messages: TMessage[]) => void`    | Called when the transcript changes.                                           |

## Returns

### State

| Name                 | Type                                               | Description                                                                                      |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `messages`           | `TMessage[]`                                       | The transcript; **per-message `status`/`error` on the message object**                           |
| `status`             | `'ready' \| 'submitted' \| 'streaming' \| 'error'` | Session status - mirrored as `data-status` on `ChatRoot` / `ChatInput.Root` / `ChatInput.Submit` |
| `error`              | `Error \| null`                                    | Session-level error                                                                              |
| `streamingMessageId` | `string \| null`                                   | Which message is streaming now                                                                   |

### Actions

| Name                           | Description                                                       |
| ------------------------------ | ----------------------------------------------------------------- |
| `sendMessage`                  | Send a message                                                    |
| `stop`                         | Abort the in-flight response                                      |
| `reload(messageId?)`           | Regenerate - optionally from a specific message                   |
| `setModel`                     | Switch model                                                      |
| `editMessage`                  | Edit a message (the composer inside a `Message` is the edit form) |
| `setMessages`                  | Replace the transcript (e.g. thread-level clear)                  |
| `getBranches` / `switchBranch` | Message branching (existing API, kept) - see `useMessageBranches` |

### Prop getters

None - `useChat` owns session state, not interactive nodes. Getters live on the hooks that own elements ([`useChatInput`](./use-chat-input.md), [`useChatScroll`](./use-chat-scroll.md), …).

### Not here (by design)

- **No `input` / `setInput` / `handleInputChange`** - input state has one owner, `useChatInput` (breaking-changes ledger).
- **Streams are provider-scoped, not mount-scoped:** keyed by conversation id in the conversations/chat context; switching threads neither aborts nor orphans an in-flight stream, and it persists to the correct thread. Use [`useConversationChat`](./use-conversation-chat.md) for thread binding.

## Example

```tsx
function MyChat() {
  const chat = useChat({ api: "/api/ag-ui" });
  const chatInput = useChatInput({ chat });

  return (
    <div>
      <div role="log" aria-relevant="additions" aria-busy={chat.status === "streaming"}>
        {chat.messages.map((m) => (
          <article key={m.id} data-role={m.role}>{getTextContent(m)}</article>
        ))}
      </div>
      <form {...chatInput.getFormProps()}>
        <textarea {...chatInput.getFieldProps()} />
        <button {...chatInput.getSubmitProps()}>
          {chatInput.isStreaming ? "Stop" : "Send"}
        </button>
      </form>
    </div>
  );
}
```

## Used by

- [`Chat`](../components/chat.md) (runs it internally at L1)
- [`ChatRoot`](../components/chat-root.md) (`chat={useChat()}` is the shared context)
- [`ChatMessageList`](../components/chat-message-list.md) · `ChatInput` · `Message` (consume via context or explicit `chat` prop)

## Related

- [`useConversationChat`](./use-conversation-chat.md) - `useChat` bound to the active conversation
- [`useChatContext`](./use-chat-context.md) - read the shared session from `ChatRoot`
- [`useCompletion`](./use-completion.md) · [`useStreaming`](./use-streaming.md)
