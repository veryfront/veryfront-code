# ChatSidebar

The conversation list — browse, create, rename, and delete conversation threads.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`ChatSidebar` is the compound over the conversations domain. Each part renders exactly one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and accepts `asChild`. Behaviour comes from [`useConversations`](../hooks/use-conversations.md) and the surrounding `ConversationsProvider`.

## Import

```tsx
import { ChatSidebar } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatSidebar.Root>
  <ChatSidebar.NewButton />
  <ChatSidebar.List>
    <ChatSidebar.Group>
      <ChatSidebar.Item>
        <ChatSidebar.Title />
        <ChatSidebar.Menu>
          <ChatSidebar.Rename />
          <ChatSidebar.Delete />
        </ChatSidebar.Menu>
      </ChatSidebar.Item>
    </ChatSidebar.Group>
  </ChatSidebar.List>
  <ChatSidebar.Empty />
</ChatSidebar.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `.Root` | `<nav>` | `data-loading` `data-empty` | Sidebar container and context. |
| `.NewButton` | `<button>` | — | Creates a new conversation. |
| `.List` | `<ul>` | — | The conversation list. |
| `.Group` | `<div>` | — | Groups items (e.g. by date). |
| `.Item` | `<li>` | `data-active` | One conversation row. |
| `.Title` | `<span>` | — | The conversation title (added via #2977). |
| `.Menu` | `ui` `DropdownMenu` | — | Per-conversation actions menu, built on the `veryfront/ui` `DropdownMenu`. |
| `.Rename` | menu item (inside `.Menu`) | — | Renames the conversation. |
| `.Delete` | menu item (inside `.Menu`) | — | Deletes the conversation. |
| `.Empty` | `<div>` | — | Shown when there are zero conversations. |

> **Removed:** the `renderItem` render-prop config is deleted. Customize rows by composing `.Item` children, or map `conversations` from the hook yourself — composition, not render-prop config.

## Props

Every part follows the library-wide node contract:

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the part's behaviour and attributes onto your own child element instead of rendering the default node. |
| `className` | `string` | Merged Tailwind-aware with the variant defaults (consumer classes win). |
| `ref` | `Ref` | Composed with internal refs; reaches the rendered node. |
| …native attributes | — | Each part `extends React.HTMLAttributes` of its node — `style`, `data-*`, `aria-*`, event handlers, `id`, everything spreads through. Consumer event handlers run first; `event.preventDefault()` cancels the internal handler. |

Conversation state comes from the nearest `ConversationsProvider` (see [`useConversationsContext`](../hooks/use-conversations-context.md)); precedence is explicit prop > nearest context > default.

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-loading` | `.Root` | Fetch in flight. |
| `data-empty` | `.Root` | Zero conversations. |
| `data-active` | `.Item` | This conversation is the active one. |

Style with CSS or Tailwind variants (e.g. `data-[active]:bg-accent`) — state is never exposed as boolean styling props.

## Examples

### Default

Childless parts render their default anatomy — `.List` renders the conversation rows for you.

```tsx
<ConversationsProvider storageKey="ops">
  <AppShell>
    <AppShell.Sidebar>
      <ChatSidebar.Root>
        <ChatSidebar.NewButton>New chat</ChatSidebar.NewButton>
        <ChatSidebar.List />
      </ChatSidebar.Root>
    </AppShell.Sidebar>
    <AppShell.Main>{/* … */}</AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

### Composed

Own the iteration: map `conversations` from the hook and compose each row from the leaves.

```tsx
import { ChatSidebar, useConversations } from 'veryfront/chat'

function Sidebar() {
  const { conversations } = useConversations()

  return (
    <ChatSidebar.Root className="flex h-full flex-col">
      <ChatSidebar.NewButton className="my-new-button">New chat</ChatSidebar.NewButton>

      <ChatSidebar.List className="flex-1 overflow-y-auto">
        {conversations.map((conversation) => (
          <ChatSidebar.Item
            key={conversation.id}
            className="group flex items-center data-[active]:bg-accent"
          >
            <ChatSidebar.Title className="truncate" />
            <ChatSidebar.Menu>
              <ChatSidebar.Rename />
              <ChatSidebar.Delete />
            </ChatSidebar.Menu>
          </ChatSidebar.Item>
        ))}
      </ChatSidebar.List>

      <ChatSidebar.Empty>No conversations yet</ChatSidebar.Empty>
    </ChatSidebar.Root>
  )
}
```

### Headless

Skip the compound — [`useConversations`](../hooks/use-conversations.md) is the same state the sidebar is built on. You render every element.

```tsx
import { useConversations } from 'veryfront/chat'

function MySidebar() {
  const { conversations, activeConversationId, select, create, remove } = useConversations()

  return (
    <nav className="my-nav">
      <button onClick={() => create()}>New chat</button>
      <ul>
        {conversations.map((c) => (
          <li key={c.id} data-active={c.id === activeConversationId || undefined}>
            <button onClick={() => select(c.id)}>{c.title}</button>
            <button onClick={() => remove(c.id)} aria-label="Delete">×</button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

## Customization

The eject path is per-piece:

1. **Restyle a row** — compose `.Item` children; every leaf (`.Title`, `.Menu`, `.Rename`, `.Delete`) is one node you can class, attribute, or swap via `asChild`.
2. **Own the iteration** — map `useConversations().conversations` yourself inside `.List` (replaces the deleted `renderItem`).
3. **Full headless** — `useConversations` returns the complete state and actions; render any markup, including your own `<nav>`.

Swapping one row leaf never forces ejecting the list; swapping the list never forces re-implementing conversation state.

## Related

- [`useConversations`](../hooks/use-conversations.md) — conversation list state and actions (the L3 hook underneath).
- [`useConversation`](../hooks/use-conversation.md) — a single conversation by id.
- [`useConversationsContext`](../hooks/use-conversations-context.md) — reads the `ConversationsProvider` context.
- `AppShell` (from `veryfront/ui`) — the layout shell the sidebar typically lives in.
