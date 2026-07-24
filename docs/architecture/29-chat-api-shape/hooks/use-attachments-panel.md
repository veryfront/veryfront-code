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

Returns the panel's context value — the [`useAttachments`](use-attachments.md)-backed state (`items`, `isLoading`, and the actions) that `AttachmentsPanel.Root` provides to its children, plus the panel-composition surface (today's shape — it re-surfaces what Root was given, plus the picker trigger):

```ts
{
  uploads: UploadedFile[]
  loading?: boolean            // proposed: replaced by useAttachments().isLoading / data-loading
  onRemoveUpload?: (id: string) => void
  onAttach?: (files: FileList) => void
  attachAccept?: string
  onClose?: () => void
  triggerAttach: () => void    // opens the hidden native picker
}
```

## Options

None. State configuration (`url | transport`, `storageKey`) belongs to `useAttachments`; this hook only reads what the surrounding compound provides.

## Returns

### State

The panel state provided by `AttachmentsPanel.Root` — the same surface as `useAttachments`: `items: UploadedFile[]` (with per-item error state) and `isLoading` — plus the panel-only fields Root was configured with: `attachAccept` (the native picker's `accept`) and `onClose` (the panel's dismiss handler, which gates `.Header`'s close button).

### Actions

The panel actions provided by `AttachmentsPanel.Root`: `upload`, `add`, `remove`, `clear`, `refresh` — plus `triggerAttach()`, which opens the hidden native file picker that `.Root` mounts (what `.Action` calls).

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
