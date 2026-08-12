# useConversation

Read a single conversation by id.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useConversation`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): single-by-id read with **zero internal consumers** - `useConversations` already covers the active-conversation flow. **Proposed cut** until a real consumer exists.

`useConversation` fetches one conversation - useful when you need a specific thread's data outside the active-conversation flow (which [`useConversations`](use-conversations.md) covers with `activeConversation`).

## Import

```tsx
import { useConversation } from "veryfront/chat";
```

## Signature

```ts
function useConversation(
  id: string,
  options?: { store?: ConversationsStore; storageKey?: string },
): UseConversationResult;

interface UseConversationResult {
  conversation: Conversation | null;
  isLoading: boolean;
  reload: () => void;
}
```

## Options

| Argument             | Type                 | Description                                                                                              |
| -------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| `id`                 | `string`             | The conversation id to load.                                                                             |
| `options.store`      | `ConversationsStore` | Injectable store - keeps the hook backend-agnostic (defaults to the same store `useConversations` uses). |
| `options.storageKey` | `string`             | Storage key for the default store.                                                                       |

## Returns

### State

| Name           | Type                   | Description                                                                                         |
| -------------- | ---------------------- | --------------------------------------------------------------------------------------------------- |
| `conversation` | `Conversation \| null` | The loaded conversation (`null`, never `undefined`, when absent - per the library-wide convention). |
| `isLoading`    | `boolean`              | Fetch in flight.                                                                                    |

### Actions

| Name     | Description                |
| -------- | -------------------------- |
| `reload` | Re-fetch the conversation. |

### Prop getters

The RFC does not define prop getters for this hook - hook state plus your own elements suffice.

## Example

```tsx
import { useConversation } from "veryfront/chat";

function ConversationPreview({ id }: { id: string }) {
  const { conversation, isLoading, reload } = useConversation(id);

  if (isLoading) return <Skeleton />;
  if (!conversation) return <button onClick={reload}>Retry</button>;
  return <h3>{conversation.title}</h3>;
}
```

## Used by

- Consumer code that needs a specific thread outside the sidebar/active flow. The [`ChatSidebar`](../components/chat-sidebar.md) compound itself is driven by [`useConversations`](use-conversations.md).

## Related

- [`useConversations`](use-conversations.md) - the full conversation list and actions.
- [`useConversationsContext`](use-conversations-context.md) - reads the `ConversationsProvider` context.
