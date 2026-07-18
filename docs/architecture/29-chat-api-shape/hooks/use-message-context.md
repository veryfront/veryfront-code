# useMessageContext

Reads the scoped context of the nearest `Message.Root` — the message, its streaming/editing state, and its per-message actions.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useMessageContext, useMessageContextOptional } from 'veryfront/chat'
```

## Signature

```ts
function useMessageContext<TMessage extends ChatMessage = ChatMessage>(): UseMessageContextResult<TMessage>

// Returns undefined instead of throwing when no Message.Root is above.
function useMessageContextOptional<TMessage extends ChatMessage = ChatMessage>():
  UseMessageContextResult<TMessage> | undefined

interface UseMessageContextResult<TMessage extends ChatMessage> {
  // State
  message: TMessage
  role: 'user' | 'assistant' | 'system'
  isStreaming: boolean
  parts: TMessage['parts']
  textContent: string
  copied: boolean
  isEditing: boolean
  // Actions
  copy: () => void
  regenerate: () => void
  startEdit: () => void
  cancelEdit: () => void
}
```

## Options

This hook takes no options — it is a context reader. It must be called under a `Message.Root` (which mounts `MessageContextProvider`); use `useMessageContextOptional` when the component may render outside one. Session callbacks (`editMessage`, `reload`) resolve from the nearest `ChatRoot` context — they are never re-threaded per message.

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `message` | `TMessage` | The full `ChatMessage<TMetadata, TDataParts, TTools>` object. |
| `role` | `'user' \| 'assistant' \| 'system'` | Message author (mirrored as `data-role` on `Message.Root`). |
| `isStreaming` | `boolean` | This message is streaming now (mirrored as `data-streaming`). |
| `parts` | `TMessage['parts']` | The message's part list. |
| `textContent` | `string` | Flat text of the message (`getTextContent`). |
| `copied` | `boolean` | Transient copied feedback (mirrored as `data-copied` on copy buttons). |
| `isEditing` | `boolean` | Edit composer active (mirrored as `data-editing` on `Message.Root`). |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `copy` | `() => void` | Copy `textContent` to the clipboard; sets `copied` transiently. |
| `regenerate` | `() => void` | Regenerate this message (session `reload` from `ChatRoot` context). |
| `startEdit` | `() => void` | Enter edit mode — render a `ChatInput` inside the message; it *is* the edit form. |
| `cancelEdit` | `() => void` | Leave edit mode without submitting. |

### Prop getters

None. `useMessageContext` is a context reader; display-only leaves need only hook state plus your own element.

## Example

```tsx
function MyMessageActions() {
  const ctx = useMessageContext()
  if (ctx.role !== 'assistant') return null
  return (
    <div className="my-actions">
      <button onClick={ctx.copy} data-copied={ctx.copied || undefined}>
        {ctx.copied ? 'Copied' : 'Copy'}
      </button>
      <button onClick={ctx.regenerate}>Regenerate</button>
      <button onClick={ctx.isEditing ? ctx.cancelEdit : ctx.startEdit}>
        {ctx.isEditing ? 'Cancel' : 'Edit'}
      </button>
    </div>
  )
}
```

## Used by

- [`Message`](../components/message.md) — `.Root` provides the context; `.Text`, `.Actions`, `.CopyAction`, `.RegenerateAction`, `.EditAction` and the other sub-parts consume it.
- [`MessageActionBar`](../components/message-action-bar.md) — re-export of the `Message.Actions` family.

## Related

- [`useMessageParts`](use-message-parts.md) — typed part groups for the current message.
- [`useClipboard`](use-clipboard.md) — the copy/copied primitive.
- [`useMessageBranches`](use-message-branches.md) — branch navigation for the current message.
