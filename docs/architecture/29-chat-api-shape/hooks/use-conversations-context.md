# useConversationsContext

Reads the `ConversationsProvider` context.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useConversationsContext` is the supported way to read the conversation state that a surrounding `ConversationsProvider` scopes. Like all providers in the library, `ConversationsProvider` renders zero nodes, and the raw context object stays unexported — this hook is the door in. Precedence follows the library-wide rule: explicit prop > nearest context > default.

## Import

```tsx
import { useConversationsContext, useConversationsContextOptional } from 'veryfront/chat'
```

## Signature

```ts
function useConversationsContext(): ConversationsContextValue
function useConversationsContextOptional(): ConversationsContextValue | undefined
```

Every `use*Context` hook in the library has an `Optional` variant: the strict variant requires a `ConversationsProvider` above it; the `Optional` variant may be used where a provider might not be present.

## Options

None.

## Returns

### State

The conversation state scoped by the nearest `ConversationsProvider` — the shared source that [`useConversations`](use-conversations.md), `useConversationChat`, and the [`ChatSidebar`](../components/chat-sidebar.md) compound read. This is the context that keys in-flight streams by conversation id: streams are provider-scoped, not mount-scoped, so switching threads neither aborts nor orphans a stream.

### Actions

Provided through the same context value; see [`useConversations`](use-conversations.md) for the conversations surface.

### Prop getters

The RFC does not define prop getters on this reader.

## Example

```tsx
import { ConversationsProvider, useConversationsContextOptional } from 'veryfront/chat'

function ThreadBadge() {
  const context = useConversationsContextOptional()
  if (!context) return null            // rendered outside a provider — fine
  return <span>{context.conversations.length} threads</span>
}

function App() {
  return (
    <ConversationsProvider storageKey="ops">
      <ThreadBadge />
      {/* … */}
    </ConversationsProvider>
  )
}
```

## Used by

- [`ChatSidebar`](../components/chat-sidebar.md) — the compound reads conversation state from the nearest provider.
- `useConversationChat` — binds the chat session to the provider's active thread.

## Related

- [`useConversations`](use-conversations.md) — conversation list state and actions.
- [`useConversation`](use-conversation.md) — a single conversation by id.
- `ConversationsProvider` — the zero-node provider this hook reads.
