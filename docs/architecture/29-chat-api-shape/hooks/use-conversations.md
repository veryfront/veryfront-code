# useConversations

Headless state and actions for the conversation list — select, create, rename, remove, and agent switching.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useConversations` owns the conversations domain. It is the L3 foundation that [`ChatSidebar`](../components/chat-sidebar.md) is built on — the hook is sufficient to rebuild the sidebar verbatim.

> **Removed:** the deprecated aliases `active` and `activeId` are **dropped** (breaking-changes ledger). Use `activeConversation` and `activeConversationId`.

## The `Conversation` type

One conversation type: **`Conversation`** — the separate `ConversationSummary` type is gone (resolved decision). The fields the reference pages rely on:

```ts
interface Conversation {
  id: string
  title: string
  /** The conversation's active/primary agent — never the sole participant. */
  agentId?: string
  /** Last-activity timestamp — drives the sidebar's recency buckets. */
  updatedAt: number
  /** Message summary — lets a list row show empty/count without loading messages. */
  messageCount: number
}
```

The full field set (e.g. `createdAt`, how lazily-loaded `messages` attach) is TBD in implementation; the fields above are the documented contract that `ChatSidebar`, `useConversation`, and this hook's return shape are written against.

## Import

```tsx
import { useConversations } from 'veryfront/chat'
```

## Signature

```ts
function useConversations(options?: UseConversationsOptions): UseConversationsResult

interface UseConversationsOptions {
  storageKey?: string
  store?: ConversationsStore  // shape TBD in implementation
}

interface UseConversationsResult {
  // state
  conversations: Conversation[]
  activeConversation: Conversation | undefined
  activeConversationId: string | undefined
  isLoading: boolean
  activeReady: boolean
  // actions
  select: (id: string) => void
  create: () => void
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  update: (id: string, patch: Partial<Conversation>) => void
  save: () => void
  bind: (...args: unknown[]) => void  // params TBD in implementation
  selectAgent: (agentId: string, options?: { conversation?: 'new' | 'same' }) => void
}
```

## Options

**Resolution rule:** an argless `useConversations()` reads the nearest [`ConversationsProvider`](use-conversations-context.md) — same list, same active thread as every other consumer of that provider. Passing options (`storageKey` and/or `store`) creates **standalone state** owned by this hook call, independent of any provider.

| Option | Type | Description |
| --- | --- | --- |
| `storageKey` | `string` | Persistence scope for the conversation list. Providing it opts out of the provider — standalone state. |
| `store` | `ConversationsStore` | Custom conversation store (shape TBD in implementation). Providing it opts out of the provider — standalone state. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `conversations` | `Conversation[]` | All conversations (see [the `Conversation` type](#the-conversation-type)). |
| `activeConversation` | `Conversation \| undefined` | The active conversation (replaces the dropped `active` alias). |
| `activeConversationId` | `string \| undefined` | Id of the active conversation (replaces the dropped `activeId` alias). |
| `isLoading` | `boolean` | Fetch in flight (drives `data-loading` on `ChatSidebar.Root`). |
| `activeReady` | `boolean` | The active conversation is resolved and ready (#2978) — no userland thread-ready guards. |

### Actions

| Name | Description |
| --- | --- |
| `select` | Activate a conversation. |
| `create` | Create a new conversation. |
| `rename` | Rename a conversation. |
| `remove` | Delete a conversation. |
| `update` | Update a conversation. |
| `save` | Persist conversation state. |
| `bind` | Bind a chat session to the active thread (used by `useConversationChat`). Params TBD in implementation. |
| `selectAgent` | Switch agents — see below. |

### Prop getters

The RFC does not define prop getters for this hook — hook state plus your own elements suffice.

## `selectAgent`

```ts
selectAgent(agentId, { conversation?: 'new' | 'same' })
```

Two plain words, no heuristics:

- **`'new'` (the default)** — creates and activates a fresh conversation with that agent.
- **`'same'`** — keeps the current conversation and switches its agent.

The shape is multi-agent-ready by construction: a conversation's `agentId` means the *active/primary* agent, never the sole participant — agent identity is carried per message. A future `policy: 'add-to-conversation'` slots into `selectAgent` additively.

## Example

```tsx
import { useConversations } from 'veryfront/chat'

function MySidebar() {
  const {
    conversations,
    activeConversationId,
    select,
    create,
    selectAgent,
  } = useConversations({ storageKey: 'ops' })

  return (
    <nav>
      <button onClick={() => create()}>New chat</button>
      <button onClick={() => selectAgent('support-agent')}>
        New chat with Support {/* default: conversation: 'new' */}
      </button>
      <button onClick={() => selectAgent('billing-agent', { conversation: 'same' })}>
        Switch this chat to Billing
      </button>
      <ul>
        {conversations.map((c) => (
          <li key={c.id} data-active={c.id === activeConversationId || undefined}>
            <button onClick={() => select(c.id)}>{c.title}</button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

## Used by

- [`ChatSidebar`](../components/chat-sidebar.md) — every part of the compound is a thin shell over this hook.
- `useConversationChat` — binds a `useChat` session to the active thread (seed + persist) and exposes `ready`.

## Related

- [`useConversation`](use-conversation.md) — a single conversation by id.
- [`useConversationsContext`](use-conversations-context.md) — reads the `ConversationsProvider` context.
- `ConversationsProvider` — the provider that scopes conversation state (renders zero nodes).
