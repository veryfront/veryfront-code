# MessageActionBar

The message action buttons — a namespace re-export of the `Message.Actions` family.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`MessageActionBar` **is** the `Message.Actions` family — one implementation, re-exported under a standalone name. `Message.*` is canonical; there is never a parallel implementation. This is a real deletion: today `MessageActionBar` is a *second, context-free* implementation (a `content` prop plus `onCopy`/`onEdit`/`onRegenerate` handler props, leaves `.Copy`/`.Copied`/`.Regenerate`/`.Edit`, each with an `icon` prop). The RFC collapses it onto the context-bound `Message.Actions` family.

## Import

```tsx
import { MessageActionBar } from 'veryfront/chat'
// canonical form:
import { Message } from 'veryfront/chat' // Message.Actions, Message.CopyAction, …
// every sub-part is also a flat named export, with its Props type:
import { Message, MessageCopyAction, type MessageCopyActionProps } from 'veryfront/chat'
```

`Message.CopyAction` and `MessageCopyAction` are the same function — namespace alias and flat export, two access styles (same for every sub-part).

## Parts index

- [`.Actions`](#messageactions--changed) — `changed`: `content` / handler props deleted; baked hover-reveal → `data-floating`
- [`.CopyAction`](#messagecopyaction--changed) — `changed`: `icon` deleted; composed `onClick`; `data-copied`
- [`.RegenerateAction`](#messageregenerateaction--changed) — `changed`: same leaf deltas as `.CopyAction`
- [`.EditAction`](#messageeditaction--changed) — `changed`: immediate `editMessage` → edit mode (`startEdit`)
- [`.Copied`](#deleted-parts) — `removed`: folded into `.CopyAction`'s `data-copied`

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`. A leaf renders its default icon when childless; pass children to replace it (no `icon` props).

```tsx
<Message.Actions>                {/* ONE <div> — data-floating, holds its space */}
  <Message.CopyAction />         {/* copy icon → check while data-copied; null without text */}
  <Message.RegenerateAction />   {/* refresh icon; null on user turns / no reload */}
  <Message.EditAction />         {/* pencil icon; enters edit mode → data-editing on the Root */}
</Message.Actions>
```

`<Message.Actions />` with **no children renders the default cluster**: `CopyAction` + `RegenerateAction` (`EditAction` is available but off by default).

## Default DOM (childless render)

What `<Message.Actions />` actually renders (today's source classes, abbreviated to layout). The bar lives inside a `Message` row whose root carries the `group/msg` hover scope — the reveal keys off *that ancestor*, not the bar itself. Nothing is absolutely positioned.

```html
<!-- ancestor: <article class="group/msg …"> (Message.Root) -->
<div class="flex items-center gap-0.5
            opacity-0 group-hover/msg:opacity-100 transition-all duration-200">
        <!-- Message.Actions — in-flow flex ROW that HOLDS ITS SPACE; hidden and
             revealed purely by OPACITY when the ancestor group/msg row is
             hovered → no layout shift, never unmounted to hide.
             Proposed: the baked opacity classes are removed; you style the
             reveal yourself off [data-floating]. -->
  <button class="inline-flex items-center justify-center size-7 rounded-full">⧉</button>
        <!-- Message.CopyAction — fixed 7×7 round icon button (icon size-3.5);
             icon swaps to ✓ while copied (proposed: [data-copied]) -->
  <button class="inline-flex items-center justify-center size-7 rounded-full">↻</button>
        <!-- Message.RegenerateAction — same 7×7 button; present only when
             reload is available (assistant turns) -->
</div>
```

In the `<Message>` childless default, this bar sits inside a footer layout div (`mt-1.5 flex items-center gap-0.5`) next to `Message.Tokens` — that footer div is yours after eject.

## Parts

### `Message.Actions` — `changed`

Changed: today's context-free root props (`content`, `onCopy(e, next)`, `onEdit`, `onRegenerate`) are deleted — context supplies them — and the baked hover-reveal classes become `data-floating`.

The bar container — one `<div>` + nothing else (the buttons read message context directly; there is no bar-scoped context).

**Layout:** in-flow flex row (`gap-0.5`) that holds its space; revealed by opacity on ancestor `group/msg` hover — zero layout shift.

Default content: `Message.CopyAction` + `Message.RegenerateAction`. **Renders `null` when the message has no text content** (today's gate). Hidden-but-animatable — **never unmounted to hide**: the RFC replaces today's baked `opacity-0 group-hover/msg:opacity-100` classes with `data-floating` so the reveal is your CSS.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | default cluster | Compose your own bar from the action leaves, in your order. |
| `asChild` | `boolean` | `false` | Merge onto your own element. |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the `<div>`; `className` merges. |

**State attributes (proposed):** `data-floating` — hidden-but-animatable.

### `Message.CopyAction` — `changed`

Changed: the `icon` prop is deleted (children replace the icon), today's `onClick(event, next)` wrap signature becomes a composed `onClick`, and copied feedback surfaces as `data-copied`.

One `<button>`. Default content: copy icon (`size-3.5`), swapping to a check while copied; `aria-label`/`title` `"Copy to clipboard"` / `"Copied!"`. Copies the message's flat `textContent` via `useClipboard`. **Renders `null` when there is no text content.**

**Layout:** in-flow fixed `size-7` round icon button.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | default icon | Replace the icon (the `icon` prop is deleted — icon-slot ban). |
| `onClick` | `MouseEventHandler` | — | Composes with the internal copy — consumer first; `preventDefault()` skips the copy. Replaces today's `onClick(event, next)` wrap signature. |
| `asChild` | `boolean` | `false` | Your element becomes the button. |
| + native | `React.ButtonHTMLAttributes<HTMLButtonElement>` · `ref` | — | Spread onto the `<button>`. |

**State attributes (proposed):** `data-copied` — transient copied feedback (today expressed only by the icon/label swap).

### `Message.RegenerateAction` — `changed`

Changed: same leaf deltas as `.CopyAction` — `icon` deleted, composed `onClick`.

One `<button>`. Default content: refresh icon; `aria-label`/`title` `"Regenerate response"`. **Renders `null` unless regeneration is available** — assistant turns only, and only when `reload` exists on the nearest `ChatRoot` context (today: `onReload` gated `role !== 'user'`). Same props table as `.CopyAction` (children replace icon, composed `onClick`, `asChild`, native + `ref`).

**Layout:** in-flow fixed `size-7` round icon button.

### `Message.EditAction` — `changed`

Changed: today it calls `editMessage(id, textContent)` immediately; proposed it enters edit mode (`startEdit`) with a nested `ChatInput` as the edit form.

One `<button>`. Default content: pencil icon; `aria-label`/`title` `"Edit message"`. **Renders `null` when editing is unavailable or there is no text content.** Same props table as `.CopyAction`. **Semantics change (proposed):** today it calls `editMessage(id, textContent)` immediately; proposed it enters edit mode (`startEdit`) — `Message.Root` gets `data-editing` and a `ChatInput` rendered inside the message *is* the edit form.

**Layout:** in-flow fixed `size-7` round icon button; available but not in the childless default cluster.

### Deleted parts

- **`MessageActionBar.Copied` — deleted.** Today it is a *second button* that swaps in while `copied` is true (check icon, `"Copied!"` label) while `.Copy` null-renders. Proposed: one `.CopyAction` button whose icon/label swap is the transient `data-copied` attribute, styled with CSS.
- **No `.Feedback` in v1** — cut (no backend endpoint); returns additively later.
- **Removed props:** `content`, `onCopy(e, next)`, `onEdit`, `onRegenerate` on the root (context supplies them — see below); `icon` on every leaf (children replace the icon).

## Context (what the parts read)

The action leaves have no bar-scoped context of their own (today's `MessageActionBarContext` goes away with the parallel implementation). They read:

- **`useMessageContext()`** — `textContent`, `copy`, `copied`, `startEdit`, `regenerate` (see [Message](./message.md#context-what-the-parts-read)).
- **`ChatRoot` context** — the session callbacks behind those (`editMessage`, `reload`). Nothing is re-threaded per action.

**TBD:** whether the standalone `MessageActionBar` re-export retains a controlled mode for use *outside* a `Message.Root` (today's context-free bar takes `content` + handlers; the proposal makes context canonical and does not spec a prop-driven fallback).

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

Style the reveal and the copied tick with CSS, not props:

```css
[data-floating] { opacity: 0; transition: opacity 150ms; }
article:hover [data-floating] { opacity: 1; }
[data-copied] .copy-icon { display: none; }
[data-copied] .check-icon { display: inline; }
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
