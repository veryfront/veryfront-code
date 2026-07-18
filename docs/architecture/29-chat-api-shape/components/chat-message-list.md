# ChatMessageList

The transcript — one scroll container with an accessible log region and a scroll-to-bottom button, driven by the `useChatScroll` contract.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatMessageList } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatMessageList>                     {/* the ONE scroll container */}
  <ChatMessageList.Content />         {/* role="log" column — default: one <Message> per turn */}
  <ChatMessageList.ScrollButton />    {/* jump to latest; inert + unfocusable at bottom */}
</ChatMessageList>
```

`<ChatMessageList>` with **no children renders exactly this default anatomy** (today's default children are `<ChatMessageList.Content />`; the scroll button today only exists via the deleted `renderScrollButton` prop). Message iteration is `children` or the default map with the `tools` registry — `renderMessage` is deleted (composition, not render-prop config).

## Default DOM (childless render)

What the transcript renders today (as composed by the preset), annotated per node. **Note:** today `.Root` is *two* nodes — a non-scrolling `relative` wrapper plus the scroll div — because the scroll button must overlay the visible viewport, not scroll away with the content. The RFC's single-node contract collapses this to **one** scroll container; how the button then anchors is part of the implementation:

```html
<div class="relative flex-1 min-h-0 flex flex-col">          <!-- wrapper (today): fills leftover height in the
                                                                  chat column; `relative` is what the scroll
                                                                  button's `absolute` is relative to;
                                                                  does NOT scroll -->
  <div role="log" aria-live="polite" data-message-list
       class="flex-1 min-h-0 overflow-y-auto">               <!-- the ONLY scrolling element; once scrollTop > 8px
                                                                  a top-edge fade is applied via mask-image so rows
                                                                  dissolve under the header instead of hard-cutting -->
    <div class="max-w-[850px] mx-auto px-9 py-6 space-y-6">  <!-- .Content: centered fixed-width column,
                                                                  vertical rhythm between rows -->
      <div class="group/msg flex w-full flex-col gap-1.5">…</div>
                                                             <!-- one Message per turn (in-flow column;
                                                                  RFC: <article>); hover reveals its actions -->
      …
      <!-- pending assistant placeholder: only while loading AND the last
           message is not yet an assistant turn -->
    </div>
  </div>

  <button aria-label="Scroll to bottom"
          class="absolute bottom-4 left-1/2 -translate-x-1/2
                 rounded-full border p-2 shadow-sm">↓</button>
      <!-- .ScrollButton: absolute overlay, bottom-center of the WRAPPER
           (the visible viewport), sibling of the scroll div — not inside it.
           Today it unmounts at bottom; RFC keeps it mounted, inert + unfocusable -->
</div>
```

## Parts

Every part renders **one** node, takes `asChild`, extends its node's `HTMLAttributes`, merges `className` (Tailwind-aware, consumer wins), and composes `ref`.

### `ChatMessageList` (`.Root`)

The scroll container `<div>` + the compound's scoped context. Default content: `<ChatMessageList.Content />` + `<ChatMessageList.ScrollButton />`; pass children to replace the viewport composition. Always renders (no null condition) — an empty thread is the container with `data-empty`.

**Layout:** in-flow flex child (`flex-1 min-h-0`) — the only scrolling element; positioning context for `.ScrollButton`. (Today: two nodes, wrapper + scroller — see Default DOM; the RFC collapses them.)

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `tools?` | `{ [name: string]: Component }` | — | Tools registry for the default map; resolution: inline render fn → registry by name → default renderer |
| `children?` | `ReactNode` | default anatomy | Your own viewport composition (replaces `.Content` + `.ScrollButton`) |
| `asChild` | `boolean` | `false` | Merge the scroll container onto your element |
| + native | `HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the single node; `className` merges |

**State attributes (proposed):** `data-at-bottom` · `data-autoscrolling` · `data-scrollable` — **updated imperatively** (no React re-render per scroll tick) — plus `data-loading` (fetch in flight) and `data-empty` (zero messages). Today none of these exist; scroll state lives in `useStickToBottom` React state.

**Behavior (today → contract):** stick-to-bottom follows new content only while pinned; a new *user* turn force-scrolls (and re-pins) even from scrolled-up history. The RFC subsumes both into [`useChatScroll`](../hooks/use-chat-scroll.md): escape-on-scroll-up + resume threshold, `turnAnchor: "bottom" | "top"`, position restore on thread switch, `preserveScrollOnPrepend`. How scroll options surface on the component (props vs. hook-only) is TBD in implementation.

### `ChatMessageList.Content`

The transcript column — one `<div>`, `role="log"`. Default content: one [`Message`](./message.md) per entry in the session's `messages` (keyed by id, streaming row marked via context), followed by a pending assistant placeholder row **only while loading and the last message is not yet an assistant turn**. Children replace the default map entirely (read `messages` from [`useChatContext`](../hooks/use-chat-context.md)).

**Layout:** in-flow inside the scroller — centered fixed-width column (`max-w-[850px] mx-auto`), uniform vertical gap between rows; taller than the viewport it scrolls within.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes<HTMLDivElement>`) + `ref` | | Own the column node; children replace the default message map |

**A11y (proposed):** `role="log"`, `aria-relevant="additions"`, `aria-busy` while streaming (no token-level SR spam); completion announced once via a visually-hidden `role="status"` region. *(Today `role="log" aria-live="polite"` sits on the scroll container, not on `.Content` — the RFC moves it here.)*

### `ChatMessageList.ScrollButton`

One `<button>` (`aria-label="Scroll to bottom"`). Default content: a down-arrow icon when childless; pass children to replace it (today's `icon` prop falls to the icon-slot ban). Clicking smooth-scrolls to the bottom and re-pins.

**Layout:** absolute overlay — bottom-center of the visible viewport (`absolute bottom-4 left-1/2 -translate-x-1/2`), floating above the rows; never in the scroll flow.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`ButtonHTMLAttributes`) + `ref` | | Own the button; children replace the default arrow |

**Render condition (proposed change):** today the button **unmounts** when pinned to bottom (`visible={!isAtBottom}` → `null`); the RFC keeps it mounted but **inert + unfocusable at bottom**, so hide/show is animatable via `[data-at-bottom]` CSS.

### Removed (today → where it went)

| Today's prop | Replacement |
| --- | --- |
| `messages` · `isLoading` | Session from `ChatRoot` context (#2973); explicit prop > nearest context > default |
| `renderMessage` | **Deleted** — `children` composition or the `tools` registry |
| `renderScrollButton` | **Deleted** — `.ScrollButton` is a composable part |
| `editMessage` · `getBranches` · `switchBranch` | `ChatRoot` context / `useMessageBranches` |
| `onSourceClick` | `Sources` / `InlineCitation` composition |
| `onFeedback` | `MessageFeedback` cut from v1 |
| `theme` · `model` · `inferenceMode` | Deleted (string theme retired; model/inference are message-level concerns) |

## Context (what the parts read)

Today the compound has an internal list context (`messages`, `renderMessage`, `contentRef`, `lastMessage`, …) that throws when `.Content` is used outside `.Root`. Under the RFC the parts read the shared session via [`useChatContext`](../hooks/use-chat-context.md) plus the scroll subsystem:

```ts
useChatScroll() // per the scroll contract:
{
  // state
  isAtBottom: boolean
  isAutoScrolling: boolean
  currentAnchorId?: string
  visibleMessageIds: string[]        // opt-in subscription
  // actions
  scrollToBottom(): void
  scrollToMessage(id: string): void
  scrollToStart(): void
  scrollToEnd(): void
}
```

Container attachment at L3 (ref vs. prop getter) is TBD in implementation.

## Examples

### Default

Inside `<Chat />` as `Chat.MessageList` — default message rendering, scroll behavior, and a11y wired up:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<ChatRoot chat={chat}>
  <ChatMessageList className="my-transcript" tools={{ web_search: MyToolCard }}>
    <ChatMessageList.Content>
      {chat.messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </ChatMessageList.Content>
    <ChatMessageList.ScrollButton className="my-scroll-btn" />
  </ChatMessageList>
</ChatRoot>
```

Style scroll state with CSS variants, not props:

```css
.my-scroll-btn { opacity: 1; transition: opacity 150ms; }
[data-at-bottom] .my-scroll-btn { opacity: 0; }   /* stays mounted — inert + unfocusable */
```

### Headless (L3)

Drive your own transcript with [`useChatScroll`](../hooks/use-chat-scroll.md) — state and actions from the hook, elements yours:

```tsx
function MyTranscript({ chat }) {
  const scroll = useChatScroll({ turnAnchor: 'bottom', preserveScrollOnPrepend: true })
  return (
    <div className="my-scroller">
      <div role="log" aria-relevant="additions" aria-busy={chat.status === 'streaming'}>
        {chat.messages.map((m) => <MyRow key={m.id} message={m} />)}
      </div>
      {!scroll.isAtBottom && (
        <button onClick={() => scroll.scrollToBottom()}>Jump to latest</button>
      )}
    </div>
  )
}
```

## Customization (eject path)

1. **Per-part first:** restyling one part type never ejects the row — pass a `tools` registry, or compose `Message.Parts` per message. The row next; the list never.
2. **Own the iteration:** pass `children` to `.Content` to replace the default map.
3. **Own the container:** `asChild` on `.Root` to merge the scroll container onto your element.
4. **Full custom:** rebuild on `useChatScroll` — same escape-on-scroll-up, resume threshold, anchoring, and prepend preservation, your DOM.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md) · [`Message`](./message.md)
- [`useChatScroll`](../hooks/use-chat-scroll.md) · [`useChat`](../hooks/use-chat.md) · [`useChatContext`](../hooks/use-chat-context.md)
