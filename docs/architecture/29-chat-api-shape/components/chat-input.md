# ChatInput

The chat composer — a single `<form>` with composable leaves for the field, attachments, model selection, voice, and submit.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatInput } from 'veryfront/chat'
```

## Anatomy

`ChatInput.Root` renders **one `<form>`** and provides scoped context to its children. It adds **zero** wrapper divs — every layout element between the form, the textarea, and the buttons is markup you wrote. `<ChatInput>` is shorthand for `<ChatInput.Root>`.

```tsx
<ChatInput.Root>
  <ChatInput.Field />
  <ChatInput.Toolbar>
    <ChatInput.Attach />
    <ChatInput.Model models={MODELS} />
    <ChatInput.Voice />
    <ChatInput.Submit />
    {/* or the split pair instead of .Submit: */}
    <ChatInput.Send />
    <ChatInput.Stop />
    <ChatInput.Export />
  </ChatInput.Toolbar>
</ChatInput.Root>
```

## Parts

Every part renders exactly one node, `extends` that node's native attributes, spreads `{...props}` onto it, and takes `asChild`. Icon-bearing leaves render their default icon when childless; pass children to replace it.

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatInput.Root` | `<form>` | `data-status` `data-dragging` `data-compact` | Form + scoped context. Submit = fold attachments → guard while uploading → send → clear. |
| `ChatInput.Field` | `<textarea>` | — | The input. IME-guarded Enter, honors `submitMode`, paste-to-attach. |
| `ChatInput.Attach` | `<button>` | — | Opens the file picker. |
| `ChatInput.Model` | `<button>` (trigger) | `data-open` | Model selector trigger. `models={…}` config lives on this leaf, not the root. |
| `ChatInput.Voice` | `<button>` | `data-listening` | Dictation toggle; transcript folds into the value via the hook. |
| `ChatInput.Submit` | `<button>` | `data-status` | Canonical morphing Send↔Stop button; `data-status` drives the swap. |
| `ChatInput.Send` | `<button>` | — | Send-only button; renders `null` when not in the send state. |
| `ChatInput.Stop` | `<button>` | — | Stop-only button; renders `null` when not streaming. |
| `ChatInput.Export` | `<button>` | — | Exports the transcript (`exportAsMarkdown` under the hood). |
| `ChatInput.Toolbar` | `<div>` | — | Pure layout convenience. Optional — use your own div freely. |

## Props (`ChatInput.Root`)

`extends React.FormHTMLAttributes<HTMLFormElement>` — every native attribute (`className`, `style`, `data-*`, `aria-*`, handlers, `ref`) passes through to the form. Handlers compose (yours first; `preventDefault` cancels the internal handler), `className` merges Tailwind-aware.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `asChild` | `boolean` | `false` | Merge form behavior onto your own element instead of rendering a `<form>`. |
| `chat` | `UseChatResult` | nearest `ChatRoot` context | The chat session to submit into. Explicit prop > nearest context > default. |
| `upload` | `UseUploadResult` | — | Attachment state from `useUpload`; submit folds pending attachments into the message and guards while uploads are in flight. |
| `voice` | `UseVoiceInputResult` | — | Voice state from `useVoiceInput`; the transcript folds into the input value — no userland transcript weaving. |
| `value` / `onChange` | `string` / `(value: string) => void` | — | Controlled mode. Omit both for uncontrolled. Input state has one owner: `useChatInput` (`useChat` does not expose `input`). |
| `submitMode` | `'enter' \| 'ctrlEnter' \| 'none'` | `'enter'` | What key submits from the field. `getFieldProps` guards IME composition so CJK input never double-submits. |

## State attributes

Style state with CSS/Tailwind variants — there are no boolean styling props.

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-status="ready\|submitted\|streaming\|error"` | `.Root` `.Submit` | Session status (mirrors `useChat().status`). |
| `data-dragging` | `.Root` | A file is dragged over the drop target. |
| `data-compact` | `.Root` | Single-line / narrow layout. |
| `data-open` | `.Model` | Model popper expanded. |
| `data-listening` | `.Voice` | Dictation active. |
| `data-disabled` | any interactive leaf | Disabled. |

## Examples

### Default (inside `<Chat/>`)

The L1 preset renders `ChatInput` for you. Its default composition is public — everything `<Chat>` renders is reachable, documented L2.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
```

### Composed (L2)

You own every layout div; config lives on the leaf; state comes through `data-*`.

```tsx
function Composer() {
  const { chat } = useConversationChat({ agentId: 'support-agent', api: '/api/ag-ui' })
  return (
    <ChatInput chat={chat}>
      <div className="my-card">                        {/* YOUR div */}
        <ChatInput.Field className="my-input" placeholder="Ask…" />
        <div className="my-toolbar">                   {/* YOUR div */}
          <ChatInput.Attach />
          <ChatInput.Model models={MODELS} />           {/* config on the leaf */}
          <ChatInput.Submit className="my-btn" data-analytics="send" />
        </div>
      </div>
    </ChatInput>
  )
}
```

`asChild` when your own element should *be* the control:

```tsx
<ChatInput.Submit asChild>
  <MyFancyButton>Send</MyFancyButton>
</ChatInput.Submit>
```

### Headless (L3)

Render every element yourself; the prop getters carry a11y and behavior. Pass your props *into* the getter — never `{...getter()} {...props}` — so handlers chain and classes merge correctly.

```tsx
function MyChatInput() {
  const chat = useConversationChat({ agentId })
  const chatInput = useChatInput({ chat: chat.chat, upload: useUpload({ api: '/api/uploads' }) })
  return (
    <form {...chatInput.getFormProps({ className: 'anything' })}>
      <textarea {...chatInput.getFieldProps({ onKeyDown: myKeyHandler })} />
      <button {...chatInput.getSubmitProps({ onClick: track, 'aria-label': 'Send' })}>
        {chatInput.isStreaming ? <Stop/> : <Send/>}
      </button>
    </form>
  )
}
```

### Editing a message

`ChatInput` nested inside a `Message` *is* the edit form — nearest provider wins, and `Message.Root` gets `data-editing`. There is no separate edit-form component family.

## Customization

The eject path is per-piece, never all-or-nothing:

1. **L1 → L2:** paste the published default composition that `<Chat>` renders, then restyle or reorder the leaves — they're yours.
2. **L2 → L3:** replace any single leaf with your own element via `asChild`, or drive it with the matching prop getter (`.Field` ↔ `getFieldProps`, `.Submit` ↔ `getSubmitProps`, `.Root` ↔ `getFormProps`). Same hook, same behavior, no forked logic.

## Related

- [`useChatInput`](../hooks/use-chat-input.md) — the hook `ChatInput` is built on
- [`useChatInputContext`](../hooks/use-chat-input-context.md) — read the scoped context
- [`useUpload`](../hooks/use-upload.md) — pending attachments
- [`useVoiceInput`](../hooks/use-voice-input.md) — dictation
- [`AttachmentPill`](./attachment-pill.md) — pending-upload chip rendered alongside the composer
