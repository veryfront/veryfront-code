# MessageActionBar

The message action buttons — a namespace re-export of the `Message.Actions` family.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`MessageActionBar` **is** the `Message.Actions` family — one implementation, re-exported under a standalone name for use outside a `Message`. `Message.*` is canonical; there is never a parallel implementation.

## Import

```tsx
import { MessageActionBar } from 'veryfront/chat'
// canonical form:
import { Message } from 'veryfront/chat' // Message.Actions, Message.CopyAction, …
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`. A leaf renders its default icon when childless; pass children to replace it (no `icon` props).

```tsx
<Message.Actions>
  <Message.CopyAction />
  <Message.RegenerateAction />
  <Message.EditAction />
</Message.Actions>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `Message.Actions` | `<div>` | `data-floating` | Container. Hidden-but-animatable — never unmounted to hide. |
| `Message.CopyAction` | `<button>` | `data-copied` | Copies the message text. |
| `Message.RegenerateAction` | `<button>` | — | Regenerates the message (via `reload` from `ChatRoot` context). |
| `Message.EditAction` | `<button>` | — | Enters edit mode (`Message.Root` gets `data-editing`; a `ChatInput` inside the message is the edit form). |

There is **no `.Copied` part** — it is deleted. Copied feedback is the transient `data-copied` attribute on `.CopyAction`, styled with CSS. There is also no `.Feedback` in v1 (cut — no backend endpoint).

## Props

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the node onto your own element. |
| …rest | native attributes of the node (`<div>` / `<button>`) | Spread onto the node — `className`, `data-*`, `aria-*`, handlers, `ref`. |

Session callbacks (`editMessage`, `reload`) come from the nearest `ChatRoot` context; the message comes from the surrounding `Message.Root` context. Nothing is re-threaded per action.

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-floating` | present | On the container — hidden-but-animatable. Style visibility with CSS; the bar is never unmounted to hide. |
| `data-copied` | present | On `.CopyAction` — transient copied feedback. |

```css
[data-floating] { opacity: 0; transition: opacity 150ms; }
article:hover [data-floating] { opacity: 1; }
[data-copied] .copy-icon { display: none; }
[data-copied] .check-icon { display: inline; }
```

## Examples

### Default

Rendered as part of the public `<Chat>` composition on each message row.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<Message.Root message={m}>
  <Message.Content>…</Message.Content>
  <Message.Actions className="my-actions">
    <Message.CopyAction className="my-action" aria-label="Copy" />
    <Message.RegenerateAction className="my-action" />
    <Message.EditAction className="my-action">Edit</Message.EditAction>
  </Message.Actions>
</Message.Root>
```

`asChild` when your own button should be the action:

```tsx
<Message.CopyAction asChild>
  <MyIconButton icon="copy" />
</Message.CopyAction>
```

### Headless (L3)

Read the message context and clipboard state; render your own buttons.

```tsx
function MyActions() {
  const { textContent, regenerate, startEdit } = useMessageContext()
  const { copied, copy } = useClipboard(textContent)
  return (
    <div className="anything">
      <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      <button onClick={regenerate}>Retry</button>
      <button onClick={startEdit}>Edit</button>
    </div>
  )
}
```

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the actions block on the row.
2. **L2:** compose the actions you want, in your order, with your buttons via `asChild` — swapping one button never touches the rest of the row.
3. **L3:** `useMessageContext()` + `useClipboard()` and your own markup.

## Related

- [`useMessageContext`](../hooks/use-message-context.md) — message state and actions
- [`useClipboard`](../hooks/use-clipboard.md) — `{ copied, copy }`
- [Message](./message.md) — the canonical home of this family
- [BranchPicker](./branch-picker.md) — branch navigation next to the actions
