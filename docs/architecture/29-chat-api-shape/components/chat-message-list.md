# ChatMessageList

The transcript — one scroll container with an accessible log region and a scroll-to-bottom button, driven by the `useChatScroll` contract.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatMessageList } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatMessageList>
  <ChatMessageList.Content>
    {/* message iteration: children, or the default map with the tools registry */}
  </ChatMessageList.Content>
  <ChatMessageList.ScrollButton />
</ChatMessageList>
```

Message iteration is `children` or the default map with the `tools` registry — `renderMessage` is deleted (composition, not render-prop config).

## Parts

Every part renders **one** node, takes `asChild`, extends its node's `HTMLAttributes`, merges `className` (Tailwind-aware, consumer wins), and composes `ref`.

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatMessageList` (`.Root`) | `<div>` (scroll container) | `data-at-bottom` · `data-autoscrolling` · `data-scrollable` · `data-loading` · `data-empty` | The one scroll container; contract = [`useChatScroll`](../hooks/use-chat-scroll.md) |
| `ChatMessageList.Content` | `role="log"` region | — | `aria-relevant="additions"`, `aria-busy` while streaming (no token-level SR spam); completion announced once via a visually-hidden `role="status"` region |
| `ChatMessageList.ScrollButton` | `<button>` | — | Scroll to bottom; **inert + unfocusable at bottom** |

## Props

Session comes from the nearest [`ChatRoot`](./chat-root.md) context (precedence: explicit prop > nearest context > default).

| Prop | Type | Description |
| --- | --- | --- |
| `tools?` | `{ [name: string]: Component }` | Tools registry for the default message map — resolution: inline render fn → registry by name → default renderer |
| `children?` | `ReactNode` | Your own message iteration (replaces the default map) |
| `asChild?` | `boolean` | Merge the scroll container onto your own element |

Scroll behavior options (`turnAnchor`, `preserveScrollOnPrepend`, …) belong to the [`useChatScroll`](../hooks/use-chat-scroll.md) contract; how they surface on the component is TBD in implementation.

## State attributes

| Attribute | When |
| --- | --- |
| `data-at-bottom` | Viewport is at the bottom of the transcript |
| `data-autoscrolling` | Library-driven scroll in progress |
| `data-scrollable` | Content overflows the container |
| `data-loading` | Fetch in flight |
| `data-empty` | Zero messages |

`data-at-bottom` / `data-autoscrolling` / `data-scrollable` are **updated imperatively** — no React re-render per scroll tick.

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
.my-scroll-btn { opacity: 1; }
[data-at-bottom] .my-scroll-btn { opacity: 0; }
```

### Headless (L3)

Drive your own transcript with [`useChatScroll`](../hooks/use-chat-scroll.md) — state and actions from the hook, elements yours. (The RFC specifies the hook's state/actions/behavior; container attachment — ref vs. prop getter — is TBD in implementation.)

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

## Customization

- **Per-part first:** restyling one part type never ejects the row — pass a `tools` registry, or compose `Message.Parts` per message. The row next; the list never.
- **Own the iteration:** pass `children` to replace the default map entirely.
- **Own the container:** `asChild` on `.Root` to merge the scroll container onto your element.
- **Full custom:** rebuild on `useChatScroll` — same escape-on-scroll-up, resume threshold, anchoring, and prepend preservation, your DOM.

## Related

- [`Chat`](./chat.md) · [`ChatRoot`](./chat-root.md)
- [`useChatScroll`](../hooks/use-chat-scroll.md) · [`useChat`](../hooks/use-chat.md)
