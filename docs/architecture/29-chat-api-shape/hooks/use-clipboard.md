# useClipboard

Copies a string to the clipboard and reports transient "copied" feedback.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useClipboard } from 'veryfront/chat'
```

## Signature

```ts
function useClipboard(text: string): UseClipboardResult

interface UseClipboardResult {
  copied: boolean
  copy: () => void
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `text` | `string` | — | The string to copy when `copy()` is called. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `copied` | `boolean` | `true` transiently after a successful copy. Copy buttons mirror this as `data-copied` — style the feedback with CSS, never a `.Copied` sub-component (deleted from `MessageActionBar`). |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `copy` | `() => void` | Write `text` to the clipboard and set `copied`. |

### Prop getters

None. Wire `copy` to your own button.

## Example

```tsx
function MyCopyButton({ text }: { text: string }) {
  const { copied, copy } = useClipboard(text)
  return (
    <button
      onClick={copy}
      data-copied={copied || undefined}
      className="my-copy [&[data-copied]]:text-green-600"
      aria-label="Copy message"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}
```

## Used by

- [`Message`](../components/message.md) — `.CopyAction` (`data-copied`); `useMessageContext` exposes the same `copy`/`copied` pair pre-bound to the message's `textContent`.
- [`MessageActionBar`](../components/message-action-bar.md) — re-export of the `Message.Actions` family.

## Related

- [`useMessageContext`](use-message-context.md) — message-bound `copy` / `copied`.
- Helper: `getTextContent(msg)` — the flat text you typically pass in.
