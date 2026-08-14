# useAttachmentsPanel

Reads the `AttachmentsPanel` compound's scoped context.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useAttachmentsPanel`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): a justified reader, but it exists only because the durable [`AttachmentsPanel`](../components/attachments-panel.md) exists - proposed to move with it into the optional attachments module, not core v1.

`useAttachmentsPanel` is the context reader for the [`AttachmentsPanel`](../components/attachments-panel.md) compound. Use it inside `AttachmentsPanel.Root` to build custom parts that share the same state the built-in parts consume - without re-threading props. Contexts are scoped: the panel shares state with _its_ children only, never as an app-wide store. The raw context object stays unexported; this hook is the supported way in.

## Import

```tsx
import { useAttachmentsPanel } from "veryfront/chat";
```

## Signature

```ts
function useAttachmentsPanel(): AttachmentsPanelContextValue;
```

Returns the panel's context value - the [`useAttachments`](use-attachments.md)-backed state (`items`, `isLoading`, and the actions) that `AttachmentsPanel.Root` provides to its children, plus the panel-only composition surface (`attachAccept`, `onClose`, `triggerAttach`):

```ts
{
  items: UploadedFile[]          // same surface as useAttachments().items (per-item error state)
  isLoading: boolean
  upload: (files: FileList) => void
  add: (files: FileList) => void
  remove: (id: string) => void
  clear: () => void
  refresh: () => void
  attachAccept?: string          // panel-only: the native picker's `accept`
  onClose?: () => void           // panel-only: dismiss handler (gates `.Header`'s close button)
  triggerAttach: () => void      // opens the hidden native picker
}
```

## Options

None. State configuration (`url | transport`, `storageKey`) belongs to `useAttachments`; this hook only reads what the surrounding compound provides.

## Returns

### State

The panel state provided by `AttachmentsPanel.Root` - the same surface as `useAttachments`: `items: UploadedFile[]` (with per-item error state) and `isLoading` - plus the panel-only fields Root was configured with: `attachAccept` (the native picker's `accept`) and `onClose` (the panel's dismiss handler, which gates `.Header`'s close button).

### Actions

The panel actions provided by `AttachmentsPanel.Root`: `upload`, `add`, `remove`, `clear`, `refresh` - plus `triggerAttach()`, which opens the hidden native file picker that `.Root` mounts (what `.Action` calls).

### Prop getters

The RFC does not define prop getters on this reader.

## Example

A custom part that lives alongside the built-in ones.

```tsx
import { AttachmentsPanel, useAttachmentsPanel } from "veryfront/chat";

function FileCount() {
  const { items, isLoading } = useAttachmentsPanel();
  if (isLoading) return null;
  return <span className="text-muted-foreground">{items.length} files</span>;
}

function FilesPanel() {
  return (
    <AttachmentsPanel.Root>
      <AttachmentsPanel.Header>
        Files
        <FileCount /> {/* your part, same context */}
      </AttachmentsPanel.Header>
      <AttachmentsPanel.List />
    </AttachmentsPanel.Root>
  );
}
```

## Used by

- [`AttachmentsPanel`](../components/attachments-panel.md) - the compound's own parts read this context; the hook exposes the same door to you.

## Related

- [`useAttachments`](use-attachments.md) - the underlying durable-file state and actions.
- [`AttachmentsPanel`](../components/attachments-panel.md) - the compound this hook reads.
