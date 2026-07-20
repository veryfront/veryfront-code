# useChatInput

The sole owner of composer input state — value, submit fold/guard/clear, attachments, and voice — with prop getters for headless rendering.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useChatInput } from 'veryfront/chat'
```

## Signature

```ts
function useChatInput(options?: {
  chat?: UseChatResult                       // else nearest ChatRoot context
  upload?: UseUploadResult
  voice?: UseVoiceInputResult
  value?: string                             // controlled mode
  onChange?: (value: string) => void
  submitMode?: 'enter' | 'ctrlEnter' | 'none'
}): {
  // State
  value: string
  canSubmit: boolean
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  isStreaming: boolean                       // sugar: status === 'streaming'
  attachments: AttachmentInfo[]
  isListening: boolean
  // Actions
  submit: () => void
  stop: () => void
  clear: () => void
  attach: (files: File[]) => void
  // Prop getters — all accept (overrides?)
  getFormProps: (overrides?) => FormProps
  getFieldProps: (overrides?) => TextareaProps
  getSubmitProps: (overrides?) => ButtonProps
  getAttachProps: (overrides?) => ButtonProps
  getVoiceProps: (overrides?) => ButtonProps
  getDropTargetProps: (overrides?) => DivProps
}
```

Options are the `ChatInput.Root` props minus the DOM props.

## Options

| Option | Type | Description |
| --- | --- | --- |
| `chat` | `UseChatResult` | The session to submit into. Falls back to the nearest `ChatRoot` context (explicit prop > nearest context > default). |
| `upload` | `UseUploadResult` | Pending attachments; submit folds them into the message and guards while uploads are in flight. |
| `voice` | `UseVoiceInputResult` | Dictation; the transcript folds into `value` inside the hook — no userland transcript weaving. |
| `value` / `onChange` | `string` / `(value: string) => void` | Controlled mode. Omit for uncontrolled. `useChatInput` is the *single* owner of input state — `useChat` does not expose `input`/`handleInputChange`. |
| `submitMode` | `'enter' \| 'ctrlEnter' \| 'none'` | Which key submits from the field. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `value` | `string` | Current input text (voice transcript already folded in). |
| `canSubmit` | `boolean` | Whether submit is currently allowed. |
| `status` | `'ready' \| 'submitted' \| 'streaming' \| 'error'` | Session status (mirrors `useChat().status`). |
| `isStreaming` | `boolean` | Sugar for `status === 'streaming'`. |
| `attachments` | `AttachmentInfo[]` | Pending attachments (from `upload`). |
| `isListening` | `boolean` | Dictation active (from `voice`). |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `submit` | `() => void` | Fold attachments → guard while uploading → send → clear. |
| `stop` | `() => void` | Abort the in-flight response. |
| `clear` | `() => void` | Clear the input value. |
| `attach` | `(files: File[]) => void` | Add files to the pending attachments. |

### Prop getters

Every getter takes `(overrides?)` — pass your props *into* the getter. Handlers compose (yours first; `preventDefault` cancels the internal handler), `className` merges Tailwind-aware, `style` shallow-merges consumer-wins, refs compose. Getter names map 1:1 to `ChatInput` parts.

| Getter | Spread onto | Part | Notes |
| --- | --- | --- | --- |
| `getFormProps` | `<form>` | `.Root` | Owns the submit pipeline. |
| `getFieldProps` | `<textarea>` | `.Field` | IME-composition guard (no CJK double-submit), `submitMode`, paste-to-attach. |
| `getSubmitProps` | `<button>` | `.Submit` | Send↔Stop by state. |
| `getAttachProps` | `<button>` | `.Attach` | Opens the file picker. |
| `getVoiceProps` | `<button>` | `.Voice` | Dictation toggle. |
| `getDropTargetProps` | your drop surface | `.Root` | Drop-zone behavior; sets `data-dragging`. |

## Example

```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId })
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload({ api: '/api/uploads' }) })
  return (
    <form {...chatInput.getFormProps()} className="anything">
      <textarea {...chatInput.getFieldProps({ onKeyDown: myKeyHandler })} className="anything" />
      <button {...chatInput.getSubmitProps({ 'aria-label': 'Send' })}>
        {chatInput.isStreaming ? <Stop/> : <Send/>}
      </button>
    </form>
  )
}
```

Editing reuses the same hook, with a concrete mechanism: `useChatInput` reads `useMessageContextOptional()`. Inside a message whose context has `isEditing`, it seeds `value` from the message's `textContent`, routes submit to `editMessage(message.id, value)` instead of `sendMessage`, and maps Escape to `cancelEdit`. No extra options — nesting *is* the wiring, which is why a `ChatInput` rendered inside a `Message` *is* the edit form (nearest provider wins).

## Used by

- [`ChatInput`](../components/chat-input.md) — every leaf is a thin shell over this hook's getters, so the two can never drift. The hook's state is scoped to children via `ChatInputContextProvider`.

## Related

- [`useChatInputContext`](./use-chat-input-context.md) — read the scoped state from inside a `<ChatInput>`
- [`useUpload`](./use-upload.md) — attachment lifecycle
- [`useVoiceInput`](./use-voice-input.md) — dictation
- `mergeProps` — the normative merge, public, for composing several hooks onto one element
