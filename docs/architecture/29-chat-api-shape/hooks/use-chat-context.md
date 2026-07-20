# useChatContext

Read the chat session shared by the nearest `ChatRoot`. Comes with an `Optional` variant for trees where a provider may be absent.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatContext, useChatContextOptional } from 'veryfront/chat'
```

## Signature

```ts
function useChatContext(): …          // the session shared via <ChatRoot chat={…}>
function useChatContextOptional(): …  // same, tolerant of a missing provider
```

The RFC specifies what these read (`ChatRoot`'s context — the shared `UseChatResult`) and that raw context objects stay **unexported** (today's rule, kept); exact return typing and missing-provider behavior of each variant are TBD in implementation.

## Options

None.

## Returns

### State

The session context provided by the nearest [`ChatRoot`](../components/chat-root.md) — i.e. the `chat={useChat()}` value that is the single shared context (#2973) — plus derived flags:

| Name | Type | Description |
| --- | --- | --- |
| `isEmpty` | `boolean` | Derived — the selector field `Chat.If` examples use |
| `ready` | `boolean` | `ChatRoot` reads `activeReady` from the nearest `ConversationsProvider`; standalone: `true` |

### Actions

Whatever the shared `UseChatResult` carries (`sendMessage`, `stop`, `reload(messageId?)`, `editMessage`, …) — see [`useChat`](./use-chat.md).

### Prop getters

None.

### Resolution rules

- **Precedence everywhere:** explicit prop > nearest context > default. Components that accept `chat` as a prop use it over this context.
- **Scoped, not global:** a `ChatRoot` shares state with *its* children only — never an app-wide implicit store.
- **Every `use*Context` has an `Optional` variant** (library-wide provider rule).

## Example

```tsx
function SendOnBehalf() {
  const chat = useChatContext()   // requires a ChatRoot ancestor
  return (
    <button onClick={() => chat.sendMessage(/* … */)}>
      Ask a follow-up
    </button>
  )
}

function MaybeStatus() {
  const chat = useChatContextOptional()  // works with or without a ChatRoot
  if (!chat) return null
  return <span data-status={chat.status} />
}
```

## Used by

- Every L2 chat component that resolves its session from context instead of an explicit `chat` prop: [`ChatMessageList`](../components/chat-message-list.md), `ChatInput`, `Message` (session callbacks like `editMessage` / `reload` come from here — never re-threaded per message)

## Related

- [`ChatRoot`](../components/chat-root.md) — the provider this reads
- [`useChat`](./use-chat.md) — creates the value you put in `ChatRoot`
- [`useConversationChat`](./use-conversation-chat.md)
