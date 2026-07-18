# useConversation

Read a single conversation by id.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useConversation` fetches one conversation — useful when you need a specific thread's data outside the active-conversation flow (which [`useConversations`](use-conversations.md) covers with `activeConversation`).

## Import

```tsx
import { useConversation } from 'veryfront/chat'
```

## Signature

```ts
function useConversation(id: string): UseConversationResult

interface UseConversationResult {
  conversation: Conversation | undefined
  isLoading: boolean
  reload: () => void
}
```

## Options

| Argument | Type | Description |
| --- | --- | --- |
| `id` | `string` | The conversation id to load. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `conversation` | `Conversation \| undefined` | The loaded conversation. |
| `isLoading` | `boolean` | Fetch in flight. |

### Actions

| Name | Description |
| --- | --- |
| `reload` | Re-fetch the conversation. |

### Prop getters

The RFC does not define prop getters for this hook — hook state plus your own elements suffice.

## Example

```tsx
import { useConversation } from 'veryfront/chat'

function ConversationPreview({ id }: { id: string }) {
  const { conversation, isLoading, reload } = useConversation(id)

  if (isLoading) return <Skeleton />
  if (!conversation) return <button onClick={reload}>Retry</button>
  return <h3>{conversation.title}</h3>
}
```

## Used by

- Consumer code that needs a specific thread outside the sidebar/active flow. The [`ChatSidebar`](../components/chat-sidebar.md) compound itself is driven by [`useConversations`](use-conversations.md).

## Related

- [`useConversations`](use-conversations.md) — the full conversation list and actions.
- [`useConversationsContext`](use-conversations-context.md) — reads the `ConversationsProvider` context.
