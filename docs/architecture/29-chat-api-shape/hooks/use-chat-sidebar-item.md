# useChatSidebarItem

Reads the per-row `ChatSidebar.Item` context.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useChatSidebarItem` is the per-item context reader for the [`ChatSidebar`](../components/chat-sidebar.md) compound — exported today; throws outside a `ChatSidebar.Item`. It is what makes a swapped or extended row keep its select/rename/delete behaviour: a fully custom row composed inside `.Item` reads the same state and actions the built-in leaves (`.Title`, `.Menu`, `.Rename`, `.Delete`) consume, without re-threading props. The raw context object stays unexported; this hook is the supported way in.

## Import

```tsx
import { useChatSidebarItem } from 'veryfront/chat'
```

## Signature

```ts
function useChatSidebarItem(): ChatSidebarItemContextValue

interface ChatSidebarItemContextValue {
  conversation: Conversation
  isActive: boolean
  canRename: boolean            // an onRename is wired somewhere
  startRename: () => void       // enter inline rename (no-op when unavailable)
  remove: () => void            // delete this conversation
  menuOpen: boolean             // ⋯ menu open (drives the row's lit state today)
  setMenuOpen: (open: boolean) => void
}
```

## Options

None. The row's data comes from the surrounding `ChatSidebar.Item` (its `conversation` prop); this hook only reads what the compound provides.

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `conversation` | [`Conversation`](use-conversations.md#the-conversation-type) | The row's conversation. |
| `isActive` | `boolean` | `conversation.id === activeId` — selection, reflected as `data-active` on the row. |
| `canRename` | `boolean` | An `onRename` is resolved (prop or provider); `.Item.Rename` null-renders when `false`. |
| `menuOpen` | `boolean` | The row's `⋯` menu is open (keeps the row highlighted today). |

### Actions

| Name | Description |
| --- | --- |
| `startRename` | Enter the row's inline rename mode (no-op when rename is unavailable). |
| `remove` | Delete this conversation. |
| `setMenuOpen` | Open/close the row's `⋯` menu. |

### Prop getters

The RFC does not define prop getters on this reader.

## Example

A custom row action that lives alongside the built-in leaves.

```tsx
import { ChatSidebar, useChatSidebarItem } from 'veryfront/chat'

function PinnedBadge() {
  const { conversation, isActive } = useChatSidebarItem()
  if (!isActive) return null
  return <span className="text-muted-foreground">· {conversation.messageCount}</span>
}

function Row({ conversation }) {
  return (
    <ChatSidebar.Item conversation={conversation}>
      <ChatSidebar.Item.Title />
      <PinnedBadge />                  {/* your part, same context */}
      <ChatSidebar.Item.Menu />
    </ChatSidebar.Item>
  )
}
```

## Used by

- [`ChatSidebar`](../components/chat-sidebar.md) — the `.Item.*` leaves read this context; the hook exposes the same door to you.

## Related

- [`useConversations`](use-conversations.md) — the underlying conversation-list state and actions.
- [`ChatSidebar`](../components/chat-sidebar.md) — the compound this hook reads.
