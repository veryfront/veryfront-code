# useMessageBranches

Branch position and navigation for the current message — a thin layer over `getBranches` / `switchBranch` on `useChat`.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useMessageBranches } from 'veryfront/chat'
```

## Signature

```ts
function useMessageBranches(): UseMessageBranchesResult

interface UseMessageBranchesResult {
  // State
  index: number
  count: number
  // Actions
  previous: () => void
  next: () => void
}
```

## Options

This hook takes no options; the message comes from the nearest `Message` context, and branch data comes from the session's existing `getBranches` / `switchBranch` on `useChat`.

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `index` | `number` | Position of the active branch. |
| `count` | `number` | Total branches for this message. |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `previous` | `() => void` | Switch to the previous branch. |
| `next` | `() => void` | Switch to the next branch. |

### Prop getters

None. Wire `previous` / `next` to your own buttons; the active branch is mirrored as `data-active` on `BranchPicker`.

## Example

```tsx
function MyBranchPicker() {
  const branches = useMessageBranches()
  if (branches.count <= 1) return null
  return (
    <div className="my-branches">
      <button onClick={branches.previous} aria-label="Previous branch">&larr;</button>
      <span>{branches.index + 1} / {branches.count}</span>
      <button onClick={branches.next} aria-label="Next branch">&rarr;</button>
    </div>
  )
}
```

## Used by

- [`BranchPicker`](../components/branch-picker.md) — `.Root <div>` (`data-active`) · `.Previous <button>` · `.Count <span>` · `.Next <button>`. `BranchPicker` and `Message.BranchPicker` are the same component (namespace re-export), never parallel implementations.

## Related

- [`useMessageContext`](use-message-context.md) — the in-context message (branching pairs with edit/regenerate).
- `useChat` — owns the underlying `getBranches` / `switchBranch`.
