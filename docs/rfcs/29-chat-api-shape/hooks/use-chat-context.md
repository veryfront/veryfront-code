# useChatContext

Read the chat session shared by the nearest `ChatRoot`. Comes with an `Optional` variant for trees where a provider may be absent.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useChatContext`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatContext, useChatContextOptional } from "veryfront/chat";
```

## Signature

```ts
function useChatContext(): UseChatResult & ChatDerivedState;
function useChatContextOptional(): (UseChatResult & ChatDerivedState) | null;

interface ChatDerivedState {
  isEmpty: boolean;
  ready: boolean;
}
```

`useChatContext` throws a provider-missing error when no `ChatRoot` exists above it. `useChatContextOptional` returns `null` in that case. Raw context objects stay **unexported** (today's rule, kept).

## Options

None.

## Returns

### State

The session context provided by the nearest [`ChatRoot`](../components/chat-root.md) - i.e. the `chat={useChat()}` value that is the single shared context (#2973) - plus derived flags:

| Name      | Type      | Description                                                                                 |
| --------- | --------- | ------------------------------------------------------------------------------------------- |
| `isEmpty` | `boolean` | Derived - the selector field `Chat.If` examples use                                         |
| `ready`   | `boolean` | `ChatRoot` reads `activeReady` from the nearest `ConversationsProvider`; standalone: `true` |

### Actions

Whatever the shared `UseChatResult` carries (`sendMessage`, `stop`, `reload(messageId?)`, `editMessage`, …) - see [`useChat`](./use-chat.md).

### Prop getters

None.

### Resolution rules

- **Precedence everywhere:** explicit prop > nearest context > default. Components that accept `chat` as a prop use it over this context.
- **Scoped, not global:** a `ChatRoot` shares state with _its_ children only - never an app-wide implicit store.
- **Every `use*Context` has an `Optional` variant** (library-wide provider rule).

## Example

```tsx
function SendOnBehalf() {
  const chat = useChatContext(); // requires a ChatRoot ancestor
  return (
    <button onClick={() => chat.sendMessage(/* … */)}>
      Ask a follow-up
    </button>
  );
}

function MaybeStatus() {
  const chat = useChatContextOptional(); // works with or without a ChatRoot
  if (!chat) return null;
  return <span data-status={chat.status} />;
}
```

## Used by

- Every L2 chat component that resolves its session from context instead of an explicit `chat` prop: [`ChatMessageList`](../components/chat-message-list.md), `ChatInput`, `Message` (session callbacks like `editMessage` / `reload` come from here - never re-threaded per message)

## Related

- [`ChatRoot`](../components/chat-root.md) - the provider this reads
- [`useChat`](./use-chat.md) - creates the value you put in `ChatRoot`
- [`useConversationChat`](./use-conversation-chat.md)
