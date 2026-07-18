# BranchPicker

Previous/next navigation between message branches — a namespace re-export of `Message.BranchPicker`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`BranchPicker` **is** `Message.BranchPicker` — one implementation, re-exported under a standalone name. It is a thin surface over the `getBranches` / `switchBranch` capabilities that **already exist on `useChat`**, via `useMessageBranches`. Today the wiring is split: a presentational `BranchPicker` (controlled `current`/`total`/`onPrev`/`onNext` props) plus a `Message.BranchPicker` wrapper that feeds it from message context — including the off-by-one bookkeeping (`BranchInfo.current` is 1-based, `switchBranch` takes a 0-based index, so prev/next are `switchBranch(id, current - 2)` / `switchBranch(id, current)`). The proposal hides that math inside `useMessageBranches`.

## Import

```tsx
import { BranchPicker } from 'veryfront/chat'
// canonical form:
import { Message } from 'veryfront/chat' // Message.BranchPicker
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`. Leaves render their default content when childless; pass children to replace it (no `icon` props).

```tsx
<BranchPicker.Root>          {/* ONE <div> — null unless >1 branch */}
  <BranchPicker.Previous />  {/* ‹ chevron — disabled on the first branch */}
  <BranchPicker.Count />     {/* "2/3" — position / total */}
  <BranchPicker.Next />      {/* › chevron — disabled on the last branch */}
</BranchPicker.Root>
```

`<BranchPicker.Root />` with **no children renders exactly this default anatomy** (Previous → Count → Next).

## Default DOM (childless render)

What the childless picker actually renders (today's source classes, abbreviated to layout). The picker is always visible when mounted — no hover reveal, no absolute positioning; visibility is all-or-nothing via the `total <= 1` null-render.

```html
<div class="inline-flex items-center gap-1 text-xs">
        <!-- BranchPicker.Root — in-flow INLINE-flex ROW, gap 1; sizes to its
             content, so it sits inline next to the action bar in a footer row -->
  <button class="size-5 flex items-center justify-center rounded-full
                 disabled:opacity-50 disabled:pointer-events-none" disabled>
    <svg class="size-3">‹</svg>
  </button>
        <!-- .Previous — fixed 5×5 round button, chevron svg size-3;
             `disabled` on the first branch (dimmed, unclickable) -->
  <span class="tabular-nums min-w-[2ch] text-center">2/3</span>
        <!-- .Count — tabular-nums + min-w-[2ch] so the row doesn't jitter
             as the numbers change width -->
  <button class="size-5 flex items-center justify-center rounded-full
                 disabled:opacity-50 disabled:pointer-events-none">
    <svg class="size-3">›</svg>
  </button>
        <!-- .Next — mirror of .Previous; `disabled` on the last branch -->
</div>
```

Note: the branch picker is **not** part of `<Message>`'s childless default anatomy — you place it in your composition (typically in the footer row next to `Message.Actions`).

## Parts

### `BranchPicker.Root`

The container — one `<div>` + the picker's scoped state. As `Message.BranchPicker` it reads the branch info for the current message from context; **renders `null` unless the message has more than one branch** (`total <= 1`) — safe to include unconditionally.

**Layout:** in-flow `inline-flex` row (`items-center gap-1`); sizes to content; always visible when mounted (no hover reveal).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | default anatomy | Compose Previous / Count / Next in your order. |
| `asChild` | `boolean` | `false` | Merge the node onto your own element. |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the `<div>`; `className` merges. |

**Removed (proposed):** today's controlled props `current` / `total` / `onPrev` / `onNext` (required on the standalone component today). Branch data and actions come from the surrounding `Message.Root` context + the session's `getBranches` / `switchBranch` (via `useMessageBranches`) — never re-threaded per message. **TBD:** whether a controlled standalone mode (today's four props) survives on the re-export for use outside a `Message.Root`.

**State attributes (proposed):** `data-active` — selected branch (per the global `data-*` contract; today the picker exposes no state attributes).

### `BranchPicker.Previous`

One `<button>`. Default content: a left-chevron glyph (`size-3` svg); `aria-label="Previous variant"`. Switches to the previous branch. **Natively `disabled` on the first branch** (`current <= 1`) — dimmed and unclickable via `disabled:opacity-50 disabled:pointer-events-none`. Children replace the glyph (the `icon` prop is deleted — icon-slot ban).

**Layout:** in-flow fixed `size-5` round icon button.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | chevron glyph | Replace the default glyph. |
| `asChild` | `boolean` | `false` | Your element becomes the button. |
| + native | `React.ButtonHTMLAttributes<HTMLButtonElement>` · `ref` | — | Spread onto the `<button>`; `onClick` composes per merge semantics. |

**State attributes (proposed):** `data-disabled` — on the interactive leaf when disabled (global contract; complements the native `disabled` attribute).

### `BranchPicker.Count`

One `<span>`. Default content: the 1-based position over the total — `2/3`. `tabular-nums min-w-[2ch] text-center` so the row doesn't jitter as numbers change. Children replace the label (e.g. `Draft {index + 1} of {count}` from the hook). Always rendered when the Root is (no own null-condition).

**Layout:** in-flow inline text; reserves `2ch` minimum width.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `children` | `ReactNode` | `current/total` | Replace the default label. |
| `asChild` + native (`HTMLAttributes<HTMLSpanElement>`, `ref`) | | — | Own the node. |

### `BranchPicker.Next`

One `<button>` — the mirror of `.Previous`: right-chevron glyph, `aria-label="Next variant"`, switches to the next branch, **natively `disabled` on the last branch** (`current >= total`). Same props table and proposed `data-disabled` as `.Previous`.

**Layout:** in-flow fixed `size-5` round icon button.

## Context (what the parts read)

The leaves read the picker's scoped state (today an internal `BranchPickerContext` of `{ current, total, onPrev, onNext }`; throws outside the Root). The public read surface is the hook:

```ts
useMessageBranches() // inside Message.Root + ChatRoot
{
  index: number       // 0-based position
  count: number       // total branches
  previous: () => void
  next: () => void
}
```

Thin over the **existing** `getBranches(messageId)` / `switchBranch(messageId, branchIndex)` on `useChat` — the hook owns the 1-based/0-based conversion today's wrapper does by hand. The message comes from the surrounding `Message.Root` context; the session callbacks from the nearest `ChatRoot` context.

## Examples

### Default

Rendered as part of the public `<Chat>` composition when a message has branches (after an edit or regenerate).

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<Message.Root message={m}>
  <Message.Content>…</Message.Content>
  <Message.BranchPicker className="my-branches">
    <BranchPicker.Previous className="my-branch-btn" aria-label="Previous branch" />
    <BranchPicker.Count className="my-branch-count" />
    <BranchPicker.Next className="my-branch-btn" aria-label="Next branch" />
  </Message.BranchPicker>
</Message.Root>
```

### Headless (L3)

```tsx
function MyBranchPicker() {
  const branches = useMessageBranches()
  if (branches.count <= 1) return null
  return (
    <div className="anything">
      <button onClick={branches.previous}>‹</button>
      <span>{branches.index + 1} / {branches.count}</span>
      <button onClick={branches.next}>›</button>
    </div>
  )
}
```

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the branch picker on the row.
2. **L2:** compose `BranchPicker.*` in your own layout; swap any node via `asChild`.
3. **L3:** `useMessageBranches()` and your own markup — or `getBranches` / `switchBranch` on `useChat` directly.

## Related

- [`useMessageBranches`](../hooks/use-message-branches.md) — `{ index, count, previous, next }`
- [`useChat`](../hooks/use-chat.md) — the underlying `getBranches` / `switchBranch`
- [Message](./message.md) — the canonical home (`Message.BranchPicker`)
- [MessageActionBar](./message-action-bar.md) — the neighboring actions family
