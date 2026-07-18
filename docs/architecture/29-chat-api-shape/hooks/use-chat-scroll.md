# useChatScroll

The transcript scroll contract — stick-to-bottom, anchoring, restore, and prepend preservation as one subsystem (subsumes `useStickToBottom`).

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatScroll } from 'veryfront/chat'
```

## Signature

```ts
function useChatScroll(options?: {
  turnAnchor?: 'bottom' | 'top'        // 'top' = ChatGPT-style user-turn-to-top
  preserveScrollOnPrepend?: boolean    // for paged history
  // visibleMessageIds is an opt-in subscription; exact option name TBD in implementation
}): {
  // State
  isAtBottom: boolean
  isAutoScrolling: boolean
  currentAnchorId: …
  visibleMessageIds: …                 // opt-in subscription

  // Actions
  scrollToBottom(): void
  scrollToMessage(id: string): void
  scrollToStart(): void
  scrollToEnd(): void
}
```

`…` = named in the RFC without a pinned type; TBD in implementation. How the hook attaches to the scroll container element (ref vs. getter) is TBD in implementation.

## Options

| Option | Type | Description |
| --- | --- | --- |
| `turnAnchor?` | `'bottom' \| 'top'` | Anchoring per turn; `'top'` scrolls the user's turn to the top (ChatGPT-style) |
| `preserveScrollOnPrepend?` | `boolean` | Keep the viewport stable when paged history is prepended |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `isAtBottom` | `boolean` | Viewport at the bottom of the transcript |
| `isAutoScrolling` | `boolean` | Library-driven scroll in progress |
| `currentAnchorId` | TBD | The message currently anchored |
| `visibleMessageIds` | TBD | Messages in view — **opt-in subscription** |

### Actions

| Name | Description |
| --- | --- |
| `scrollToBottom()` | Jump to the latest content |
| `scrollToMessage(id)` | Scroll a specific message into view |
| `scrollToStart()` / `scrollToEnd()` | Jump to transcript extremes |

### Prop getters

None specified in the RFC.

### Behavior (normative)

- **Escape-on-scroll-up + resume threshold:** scrolling up escapes auto-scroll; scrolling back near the bottom resumes it.
- **Position restore on thread switch.**
- **`preserveScrollOnPrepend`** for paged history.
- **`data-at-bottom` · `data-autoscrolling` · `data-scrollable`** on `ChatMessageList` are updated **imperatively** — no React re-render per scroll tick.
- `ChatMessageList.ScrollButton` is inert + unfocusable at bottom.

## Example

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

## Used by

- [`ChatMessageList`](../components/chat-message-list.md) — the component's contract *is* this hook (`.Root` scroll container, `.ScrollButton`)
- `AppShell` surfaces that host a transcript

## Related

- [`ChatMessageList`](../components/chat-message-list.md)
- [`useChat`](./use-chat.md) — `streamingMessageId` and message state the scroller reacts to
