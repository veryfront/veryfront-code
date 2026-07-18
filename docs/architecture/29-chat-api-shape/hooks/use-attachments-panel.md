# useAttachmentsPanel

Reads the `AttachmentsPanel` compound's scoped context.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useAttachmentsPanel` is the context reader for the [`AttachmentsPanel`](../components/attachments-panel.md) compound. Use it inside `AttachmentsPanel.Root` to build custom parts that share the same state the built-in parts consume — without re-threading props. Contexts are scoped: the panel shares state with *its* children only, never as an app-wide store. The raw context object stays unexported; this hook is the supported way in.

## Import

```tsx
import { useAttachmentsPanel } from 'veryfront/chat'
```

## Signature

```ts
function useAttachmentsPanel(): AttachmentsPanelContextValue
```

Returns the panel's context value — the [`useAttachments`](use-attachments.md)-backed state (`items`, `isLoading`, and the actions) that `AttachmentsPanel.Root` provides to its children.

## Options

None. State configuration (`url | transport`, `storageKey`) belongs to `useAttachments`; this hook only reads what the surrounding compound provides.

## Returns

### State

The panel state provided by `AttachmentsPanel.Root` — the same surface as `useAttachments`: `items: UploadedFile[]` (with per-item error state) and `isLoading`.

### Actions

The panel actions provided by `AttachmentsPanel.Root`: `upload`, `add`, `remove`, `clear`, `refresh`.

### Prop getters

The RFC does not define prop getters on this reader.

## Example

A custom part that lives alongside the built-in ones.

```tsx
import { AttachmentsPanel, useAttachmentsPanel } from 'veryfront/chat'

function FileCount() {
  const { items, isLoading } = useAttachmentsPanel()
  if (isLoading) return null
  return <span className="text-muted-foreground">{items.length} files</span>
}

function FilesPanel() {
  return (
    <AttachmentsPanel.Root>
      <AttachmentsPanel.Header>
        Files
        <FileCount />                    {/* your part, same context */}
      </AttachmentsPanel.Header>
      <AttachmentsPanel.List />
    </AttachmentsPanel.Root>
  )
}
```

## Used by

- [`AttachmentsPanel`](../components/attachments-panel.md) — the compound's own parts read this context; the hook exposes the same door to you.

## Related

- [`useAttachments`](use-attachments.md) — the underlying durable-file state and actions.
- [`AttachmentsPanel`](../components/attachments-panel.md) — the compound this hook reads.
