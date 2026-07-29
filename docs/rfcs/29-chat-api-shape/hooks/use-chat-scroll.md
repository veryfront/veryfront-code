# useChatScroll

The transcript scroll contract - stick-to-bottom, anchoring, restore, and prepend preservation as one subsystem (subsumes `useStickToBottom`).

> **Status: proposed (RFC).** This page documents the _proposed_ API shape - not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatScroll } from "veryfront/chat";
```

## Signature

```ts
function useChatScroll(options?: {
  turnAnchor?: "bottom" | "top"; // 'top' = ChatGPT-style user-turn-to-top
  preserveScrollOnPrepend?: boolean; // for paged history
  observeVisibleMessages?: boolean;
}): {
  // State
  isAtBottom: boolean;
  isAutoScrolling: boolean;
  currentAnchorId: string | null;
  visibleMessageIds: string[]; // populated only when observeVisibleMessages is true

  // Actions
  scrollToBottom(): void;
  scrollToMessage(id: string): void;
  scrollToStart(): void;
  scrollToEnd(): void;

  // Attachment
  viewportRef: React.Ref<HTMLElement>;
  getViewportProps(
    overrides?: React.HTMLAttributes<HTMLElement>,
  ): React.HTMLAttributes<HTMLElement>;
};
```

The hook attaches to your scroll container via **`viewportRef` or `getViewportProps(overrides?)`** - attach either to your scroller (resolved; see _State ownership_ in the RFC).

## Options

| Option                     | Type                | Description                                                                    |
| -------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| `turnAnchor?`              | `'bottom' \| 'top'` | Anchoring per turn; `'top'` scrolls the user's turn to the top (ChatGPT-style) |
| `preserveScrollOnPrepend?` | `boolean`           | Keep the viewport stable when paged history is prepended                       |
| `observeVisibleMessages?`  | `boolean`           | Enables intersection tracking for `visibleMessageIds`; defaults to `false`.    |

## Returns

### State

| Name                | Type             | Description                                                             |
| ------------------- | ---------------- | ----------------------------------------------------------------------- |
| `isAtBottom`        | `boolean`        | Viewport at the bottom of the transcript                                |
| `isAutoScrolling`   | `boolean`        | Library-driven scroll in progress                                       |
| `currentAnchorId`   | `string \| null` | The message currently anchored                                          |
| `visibleMessageIds` | `string[]`       | Messages in view - populated only when `observeVisibleMessages` is true |

### Actions

| Name                                | Description                         |
| ----------------------------------- | ----------------------------------- |
| `scrollToBottom()`                  | Jump to the latest content          |
| `scrollToMessage(id)`               | Scroll a specific message into view |
| `scrollToStart()` / `scrollToEnd()` | Jump to transcript extremes         |

### Prop getters

| Name                           | Description                                                                                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getViewportProps(overrides?)` | Attach the scroll subsystem to your scroller - merges the viewport ref and scroll handlers; consumer overrides fold in. `viewportRef` is the ref-only alternative when you don't need the merged props |

### Behavior (normative)

- **Escape-on-scroll-up + resume threshold:** scrolling up escapes auto-scroll; scrolling back near the bottom resumes it.
- **Position restore on thread switch.**
- **`preserveScrollOnPrepend`** for paged history.
- **`data-at-bottom` · `data-autoscrolling` · `data-scrollable`** on `ChatMessageList` are updated **imperatively** - no React re-render per scroll tick.
- `ChatMessageList.ScrollButton` is inert + unfocusable at bottom.

## Example

```tsx
function MyTranscript({ chat }) {
  const scroll = useChatScroll({ turnAnchor: "bottom", preserveScrollOnPrepend: true });
  return (
    <div {...scroll.getViewportProps({ className: "my-scroller" })}>
      <div role="log" aria-relevant="additions" aria-busy={chat.status === "streaming"}>
        {chat.messages.map((m) => <MyRow key={m.id} message={m} />)}
      </div>
      {!scroll.isAtBottom && (
        <button onClick={() => scroll.scrollToBottom()}>
          Jump to latest
        </button>
      )}
    </div>
  );
}
```

## Used by

- [`ChatMessageList`](../components/chat-message-list.md) - the component's contract _is_ this hook (`.Root` scroll container, `.ScrollButton`)
- `AppShell` surfaces that host a transcript

## Related

- [`ChatMessageList`](../components/chat-message-list.md)
- [`useChat`](./use-chat.md) - `streamingMessageId` and message state the scroller reacts to
