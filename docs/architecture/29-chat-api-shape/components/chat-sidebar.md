# ChatSidebar

The conversation list — browse, create, rename, and delete conversation threads.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`ChatSidebar` is the compound over the conversations domain. Each part renders exactly one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and accepts `asChild`. It is **conversation-native**: inside a `ConversationsProvider` it needs no props — the list, active id, and select/new/delete/rename actions come from context; explicit props override (precedence: explicit prop > nearest context > default). `<ChatSidebar />` (no `.Root`) is the one-shot preset: Root + `.NewButton` + auto `.List`, wrapped in the standalone rail chrome.

## Import

```tsx
import { ChatSidebar } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatSidebar.Root>                 {/* <nav> rail column · data-loading · data-empty (proposed) */}
  <ChatSidebar.NewButton />        {/* <button> — "New chat", wires create() */}
  <ChatSidebar.List>               {/* <ul> — scroll region; auto-groups by recency when childless */}
    <ChatSidebar.Group>            {/* <div> — labeled recency bucket ("Today", "Yesterday", …) */}
      <ChatSidebar.Item>           {/* <li> — one conversation row · data-active (proposed) */}
        <ChatSidebar.Item.Title /> {/* <span> — conversation title, truncating (proposed, #2977) */}
        <ChatSidebar.Item.Menu>    {/* ui DropdownMenu — hover-revealed ⋯ trigger + portalled entries */}
          <ChatSidebar.Item.Rename />  {/* menu item — inline rename; null without onRename */}
          <ChatSidebar.Item.Delete />  {/* menu item — destructive delete */}
        </ChatSidebar.Item.Menu>
      </ChatSidebar.Item>
    </ChatSidebar.Group>
  </ChatSidebar.List>
  <ChatSidebar.Empty />            {/* <div> — "No chats yet", centered */}
</ChatSidebar.Root>
```

`<ChatSidebar.List />` with no children auto-groups the context conversations by recency (Today / Yesterday / Previous 7 days / Older) and renders `.Empty` when there are none.

## Default DOM (childless render)

What the preset `<ChatSidebar />` inside a `ConversationsProvider` actually renders today (classes abbreviated to layout):

```html
<div class="w-60 shrink-0 max-sm:absolute max-sm:z-20 max-sm:shadow-xl flex flex-col h-full">
  <!-- ^ .Root with the PRESET's rail chrome: ≥sm an in-flow 240px fixed-width column that never shrinks;
       on small screens it becomes an absolute overlay (relative to the nearest positioned ancestor — the
       chat shell), stacked z-20 with a shadow. `ChatSidebar.Root` alone is width-agnostic: just `flex flex-col h-full`. -->
  <div class="px-3 pt-4 pb-1">                              <!-- .NewButton — today a padded wrapper div (see part note)… -->
    <button class="w-full">New chat</button>                <!-- …around a full-width button; in-flow, pinned above the scroll region -->
  </div>
  <div class="flex-1 overflow-y-auto px-2 pt-2 pb-3 space-y-3">  <!-- .List — THE scroll region; takes remaining height; 12px gap between groups -->
    <div class="space-y-0.5">                               <!-- .Group — tight 2px rhythm between rows -->
      <div class="px-2.5 py-1 text-[11px] uppercase">Today</div>  <!-- group label — in-flow heading, not sticky -->
      <div data-active class="group/li flex items-center gap-1 rounded px-2.5 py-1.5 cursor-pointer">
        <!-- ^ .Item — in-flow flex row; data-active present when selected OR its ⋯ menu is open (today's computation) -->
        <div class="min-w-0 flex-1">                        <!-- title column — takes remaining width; min-w-0 enables truncation -->
          <div class="truncate text-[13px]">Quarterly report Q&A</div>  <!-- title line (the proposed .Title leaf) -->
        </div>
        <div class="shrink-0 opacity-0 group-hover/li:opacity-100 focus-within:opacity-100">
          <!-- ^ action slot — IN-FLOW (space reserved, not absolute), revealed by opacity on row hover /
               focus-within; opacity-100 while the row is active or its menu is open. Clicks here stopPropagation
               so they never select the row. -->
          <button aria-label="More actions for Quarterly report Q&A">⋯</button>  <!-- .Menu trigger; the menu CONTENT is a portalled popover (align="end", min-w 160px), outside the row's flow -->
        </div>
      </div>
      <!-- …more rows -->
    </div>
    <!-- …more groups. INSTEAD of groups, the region holds ONE of: -->
    <!-- skeleton (until client mount, or while `loading`): an <output aria-label="Loading conversations"> mirroring
         a real group (label bar + 5 text-bar rows) at the same position, so the loaded list doesn't jump -->
    <!-- .Empty: flex flex-col items-center justify-center h-full text-center — centered in the scroll region -->
  </div>
</div>
```

Two row states swap the row's DOM entirely today: **rename mode** replaces the whole row with a fixed-height (`h-8`, matching the display row so nothing resizes) accent-tinted `<div>` holding a borderless `<input class="min-w-0 flex-1">` — Enter/blur commits (trimmed; no-op when empty or unchanged), Escape cancels. And `isOpen={false}` on the root renders **nothing at all** (today; the prop is proposed-deleted, see `.Root`).

## Parts

Every part accepts `asChild`, merges `className` Tailwind-aware (consumer wins), composes `ref`s, and spreads native attributes of its node; consumer event handlers run first and `event.preventDefault()` cancels the internal handler.

### `ChatSidebar.Root`

The rail container + the compound's scoped context. One node — today a `<div>` (`flex flex-col h-full`, width-agnostic — the composed layout provides width; only the standalone preset adds the `w-60` rail chrome), **proposed `<nav>`**. Resolves every data/action prop against the surrounding `ConversationsProvider`: explicit prop > provider > default (`noop` select/delete; new-button hidden without a create action).

**Layout:** vertical flex column filling its parent's height; `.NewButton` pinned above, `.List` scrolls (`flex-1`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `conversations` | `ConversationSummary[]` | provider's list | Conversations to show, newest first |
| `activeId` | `string \| null` | provider's `activeConversationId` | Selected conversation; drives each `.Item`'s active state |
| `onSelect` | `(id: string) => void` | provider's `select` | Row click |
| `onDelete` | `(id: string) => void` | provider's `remove` | `.Item.Delete` |
| `onRename` | `(id: string, title: string) => void` | provider's `rename` | Inline rename commit; when unresolvable, `.Item.Rename` null-renders |
| `onNew` | `() => void` | provider's `create` | `.NewButton` |
| `loading` | `boolean` | `false` | Today: forces `.List`'s skeleton. **Proposed:** replaced by `data-loading` reflecting `useConversations().isLoading`; whether a controlled boolean override survives is TBD |
| `isOpen` | `boolean` | `true` | Today: `false` renders `null` (the whole rail unmounts). **Proposed: deleted** — open/closed belongs to the layout (`AppShell`) or your own conditional render, per the boolean-props ledger |
| `fill` | `boolean` | `false` | *Deprecated today* (root fills its parent by default); not carried into the proposal |
| `renderItem` | `(conversation, { isActive, onSelect, onDelete?, onRename? }) => ReactNode` | — | **Proposed: deleted.** Compose `.Item` children or map `conversations` yourself — composition, not render-prop config |
| `children` *(required)* | `ReactNode` | — | Root has no default anatomy of its own; the childless one-shot is the `<ChatSidebar />` preset (Root + `.NewButton` + `.List`) |
| `asChild` + native | `React.HTMLAttributes` · `ref` | — | Spread onto the single node; `className` merges |

**State attributes (proposed):** `data-loading` (fetch in flight) · `data-empty` (zero conversations). Today neither exists on the root — loading is presented only by the skeleton `.List` mounts.

### `ChatSidebar.NewButton`

The "new conversation" action, wiring the resolved `onNew` from context. Today it renders **two** nodes — a padded wrapper `<div class="px-3 pt-4 pb-1">` around a full-width primary `Button`; **proposed: exactly one `<button>`** per the node contract (the padding wrapper becomes your layout). Default label **"New chat"**; children replace it. Today it takes a leading `icon` prop; **proposed: `icon` deleted** (icon-slot props are banned RFC-wide — childless renders the default, children replace).

**Layout:** in-flow `shrink-0` block above the scroll region; the button spans the rail's width.

**Render conditions:** always renders when mounted (click no-ops if no create action resolved). The *preset* includes it only when `onNew` is passed or a provider is present.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `icon` | `ReactNode` | — | Leading icon (today; **proposed: deleted** — pass children) |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | | Own the node; children replace "New chat" |

### `ChatSidebar.List`

The scrollable region. One node — today a `<div>`, **proposed `<ul>`**. Default content, in priority order: **(1)** the loading skeleton — until the client mounts (conversations may load from `localStorage`, so the first paint has none; the skeleton avoids flashing "No chats yet") or while `loading`; **(2)** the conversations sorted newest-activity-first and bucketed into `.Group`s by recency (`Today` / `Yesterday` / `Previous 7 days` / `Older`, computed from `updatedAt`), one `.Item` per conversation; **(3)** `.Empty` when there are zero conversations. Children replace all of it — own the iteration.

**Layout:** `flex-1 overflow-y-auto` — this part (not the root) is the scroll region; `space-y-3` between groups.

The skeleton is an internal `<output aria-label="Loading conversations">` mirroring a real group's geometry — **there is no public `.Loading` part** (unlike `AttachmentsPanel`); the loading surface is `data-loading` on `.Root` plus this built-in placeholder. Whether a `.Loading` part is added for parity: TBD. Today `renderItem` is consumed here per-row; **proposed: deleted**.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the skeleton/groups/empty default (map `useConversations().conversations` yourself) |

### `ChatSidebar.Group`

A labeled cluster of rows. Today it renders the `ui` `List` container (a `<div>` with tight `space-y-0.5` rhythm) holding an optional `ListLabel` heading; **proposed `<div>`**. Default content: the label (uppercase, 11px, faint — e.g. a recency bucket name) when `label` is provided, then your rows.

**Layout:** in-flow block; label is a normal in-flow heading (not sticky); groups are spaced by `.List`'s `space-y-3`.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `label` | `ReactNode` | — | Section heading; omit for an unlabeled group (the label node is skipped entirely) |
| `children` *(required)* | `ReactNode` | — | The rows |
| `asChild` + native (`HTMLAttributes`, `ref`) | | | Own the node |

### `ChatSidebar.Item`

One conversation row. Today it renders the `ui` `ListItem` `<div>`; **proposed `<li>`**. Select on click; rename/delete via the trailing `⋯` menu. Default content: truncating title line (`min-w-0 flex-1` column) + the hover-revealed action slot holding `.Item.Menu`.

Per-row state computed today: `isActive = conversation.id === activeId`; the row's highlight (and today's `data-active`, set by `ListItem`) is `isActive || menuOpen` — the row stays lit while its menu is open. **Proposed:** `data-active` replaces the `isActive` boolean prop surface and means *selection*; whether menu-open continues to light the row (e.g. via a separate attribute) is TBD. Entering **rename mode** swaps the entire row for a fixed-height inline `<input>` (see Default DOM).

> **Composition change (proposed):** today `children` fills only the trailing *action slot* (everything else — title, layout — stays `ListItem`-rendered). The proposed shape makes `children` replace the **whole row**, composed from the leaves (`.Title`, `.Menu`), matching every other compound's render-or-compose rule.

**Layout:** in-flow flex row (`gap-1 px-2.5 py-1.5`), pointer cursor; title column `min-w-0 flex-1` (truncation), action slot `shrink-0` **in-flow** (space reserved — the menu button is not absolutely positioned) and opacity-revealed on row hover / `focus-within` / active.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `conversation` *(required)* | `ConversationSummary` | — | The row's conversation; provides the per-item context (`useChatSidebarItem()`) the leaves read |
| `asChild` + native (`HTMLAttributes`, `ref`) | | | Own the node; children compose the row (proposed) / fill the action slot (today) |

**State attributes:** `data-active` — present today via `ListItem` (for `isActive || menuOpen`); **proposed** as the documented contract (selection). Style with `data-[active]:bg-accent`.

### `ChatSidebar.Item.Title` *(proposed — #2977)*

One `<span>`: the conversation's title, truncating. Does not exist today — the title is rendered internally by `ListItem`'s `title` prop, so a composed row currently has no addressable title leaf. #2977 adds it so the default row is fully recomposable. Default content: `conversation.title`. TBD: whether `.Title` also hosts the inline-rename input when rename mode is entered, or rename stays a whole-row swap. Full prop set TBD beyond the shared node contract.

**Layout:** in-flow text span; give its wrapper `min-w-0`/`flex-1` (or class the span `truncate`) for ellipsis.

### `ChatSidebar.Item.Menu`

The row's `⋯` actions menu, built on the `veryfront/ui` `DropdownMenu` (not a from-scratch popover). Two pieces: the **trigger** — an icon-ghost `<button>` (`aria-label="More actions for <title>"`, three-dots glyph) sitting in the row's action slot — and the **content** — a portalled popover (`align="end"`, min-width 160px) holding the entries. Default entries: `.Rename` then `.Delete`; children replace the *entries* (the trigger stays), so you can add or reorder actions without re-implementing the row. Open state lives on the item context (`menuOpen` / `setMenuOpen`) — which is how the row stays highlighted while the menu is open.

**Layout:** trigger is an in-flow child of the hover-revealed action slot; content is positioned by the `DropdownMenu` popper **outside the row's flow** (portal), so it never affects row height or the list's scroll.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `icon` | `ReactNode` | `⋯` glyph | Trigger glyph override (today; **proposed: deleted** per the icon-prop ban — replacement mechanism for the trigger glyph is TBD, since `children` here means the entries) |
| `children` | `ReactNode` | `.Rename` + `.Delete` | The menu entries |
| `asChild` + native + `ref` | | | TBD which node (trigger vs content) the native spread targets — the part spans a trigger + portal pair |

### `ChatSidebar.Item.Rename`

A menu entry (`ui` `DropdownMenuItem`) inside `.Menu`. Default content: pencil icon + **"Rename"**; children replace the label, and (today) an `icon` prop overrides the glyph — **proposed: `icon` deleted**. Selecting it enters the row's inline rename mode (`startRename` from the item context). **Renders `null` when rename is unavailable** (no `onRename` resolved from props or provider) — safe to include unconditionally.

**Layout:** in-flow entry inside the portalled menu content.

| Prop | Type | Description |
| --- | --- | --- |
| `icon` | `ReactNode` | Glyph override (today; **proposed: deleted**) |
| `asChild` + native + `ref` | | Own the entry; children replace "Rename" |

### `ChatSidebar.Item.Delete`

A menu entry (`ui` `DropdownMenuItem`) inside `.Menu`, styled destructive. Default content: trash icon + **"Delete"**; children replace the label (today also an `icon` prop — **proposed: deleted**). Selecting it calls the resolved delete with this row's id (`remove` from the item context). Always renders (delete falls back to a provider `remove`; today an unresolved delete is a no-op).

**Layout:** in-flow entry inside the portalled menu content.

| Prop | Type | Description |
| --- | --- | --- |
| `icon` | `ReactNode` | Glyph override (today; **proposed: deleted**) |
| `asChild` + native + `ref` | | Own the entry; children replace "Delete" |

### `ChatSidebar.Empty`

One `<div>`. Default content: a faint **"No chats yet"** paragraph; children replace it. Today it renders whenever mounted, and the *`.List` default anatomy* gates it (shown only with zero conversations after mount); **proposed: self-gates — renders `null` unless the conversation list is empty**, so it is safe to include unconditionally (as the Composed example assumes).

**Layout:** fills its container's height and centers its content (`flex flex-col items-center justify-center text-center`) — in-flow, not an overlay.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default copy |

## Context (what the parts read)

Two layers. The **sidebar context** (provided by `.Root`, resolved props-over-provider) — today internal-only; whether a public `useChatSidebar()` reader ships is TBD (the documented reader path is [`useConversationsContext`](../hooks/use-conversations-context.md) on the provider itself):

```ts
{
  conversations: ConversationSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => void
  onNew?: () => void
  loading?: boolean        // proposed: data-loading on .Root
  // renderItem — deleted (proposed)
}
```

The **item context**, `useChatSidebarItem()` — exported today; throws outside `ChatSidebar.Item`. This is what makes a swapped or extended row menu keep rename/delete/select behaviour:

```ts
{
  conversation: ConversationSummary
  isActive: boolean
  canRename: boolean            // an onRename is wired somewhere
  startRename: () => void       // enter inline rename (no-op when unavailable)
  remove: () => void            // delete this conversation
  menuOpen: boolean             // ⋯ menu open (drives the row's lit state today)
  setMenuOpen: (open: boolean) => void
}
```

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
            conversation={conversation}
            className="group flex items-center data-[active]:bg-accent"
          >
            <ChatSidebar.Item.Title className="truncate" />
            <ChatSidebar.Item.Menu>
              <ChatSidebar.Item.Rename />
              <ChatSidebar.Item.Delete />
            </ChatSidebar.Item.Menu>
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

1. **Restyle a row** — compose `.Item` children; every leaf (`.Title`, `.Menu`, `.Rename`, `.Delete`) is one node you can class, attribute, or swap via `asChild`, and `useChatSidebarItem()` keeps a fully custom row's select/rename/delete behaviour intact.
2. **Own the iteration** — map `useConversations().conversations` yourself inside `.List` (replaces the deleted `renderItem`).
3. **Full headless** — `useConversations` returns the complete state and actions; render any markup, including your own `<nav>`.

Swapping one row leaf never forces ejecting the list; swapping the list never forces re-implementing conversation state.

## Related

- [`useConversations`](../hooks/use-conversations.md) — conversation list state and actions (the L3 hook underneath).
- [`useConversation`](../hooks/use-conversation.md) — a single conversation by id.
- [`useConversationsContext`](../hooks/use-conversations-context.md) — reads the `ConversationsProvider` context.
- `AppShell` (from `veryfront/ui`) — the layout shell the sidebar typically lives in.
