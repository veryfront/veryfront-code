# BranchPicker

Previous/next navigation between message branches — a namespace re-export of `Message.BranchPicker`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`BranchPicker` **is** `Message.BranchPicker` — one implementation, re-exported under a standalone name for use outside a `Message`. It is a thin surface over the `getBranches` / `switchBranch` capabilities that already exist on `useChat`, via `useMessageBranches`.

## Import

```tsx
import { BranchPicker } from 'veryfront/chat'
// canonical form:
import { Message } from 'veryfront/chat' // Message.BranchPicker
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`. Leaves render their default content when childless; pass children to replace it.

```tsx
<BranchPicker.Root>
  <BranchPicker.Previous />
  <BranchPicker.Count />
  <BranchPicker.Next />
</BranchPicker.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `BranchPicker.Root` | `<div>` | `data-active` | Container. As `Message.BranchPicker`, carries `data-active` for the selected branch. |
| `BranchPicker.Previous` | `<button>` | — | Switches to the previous branch. |
| `BranchPicker.Count` | `<span>` | — | The current position and total (e.g. `2 / 3`). |
| `BranchPicker.Next` | `<button>` | — | Switches to the next branch. |

## Props (`BranchPicker.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the root node onto your own element. |
| …rest | native `<div>` attributes | Spread onto the root — `className`, `data-*`, `aria-*`, handlers, `ref`. |

The message comes from the surrounding `Message.Root` context; branch actions come from the session (`useChat`'s `getBranches` / `switchBranch`) via the nearest `ChatRoot` context — never re-threaded per message.

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-active` | present | Selected. |
| `data-disabled` | present | On an interactive leaf when disabled (global contract). |

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

`useMessageBranches()` returns `{ index, count, previous, next }` — thin over the existing `getBranches` / `switchBranch` on `useChat`.

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the branch picker on the row.
2. **L2:** compose `BranchPicker.*` in your own layout; swap any node via `asChild`.
3. **L3:** `useMessageBranches()` and your own markup — or `getBranches` / `switchBranch` on `useChat` directly.

## Related

- [`useMessageBranches`](../hooks/use-message-branches.md) — `{ index, count, previous, next }`
- [`useChat`](../hooks/use-chat.md) — the underlying `getBranches` / `switchBranch`
- [Message](./message.md) — the canonical home (`Message.BranchPicker`)
- [MessageActionBar](./message-action-bar.md) — the neighboring actions family
