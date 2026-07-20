# useUpload

Composer-side pending-upload state — the attachment list, its lifecycle, and drop-target/file-input prop getters.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useUpload } from 'veryfront/chat'
```

## Signature

```ts
function useUpload(options: {
  api?: string                 // one of api | transport
  transport?: Transport
  accept?: string
  maxSize?: number
  maxFiles?: number
}): UseUploadResult

interface UseUploadResult {
  attachments: AttachmentInfo[]
  upload: (files: File[]) => void
  remove: (id: string) => void
  retry: (id: string) => void
  clear: () => void
  getDropTargetProps: (overrides?) => DivProps
  getAttachInputProps: (overrides?) => InputProps
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `api` \| `transport` | `string` \| transport object | Where uploads go — endpoint URL or transport. |
| `accept` | `string` | Accepted file types. |
| `maxSize` | `number` | Maximum file size. |
| `maxFiles` | `number` | Maximum number of pending files. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `attachments` | `AttachmentInfo[]` | Pending attachments with per-item lifecycle state (`idle → uploading → processing → error \| done`). **Errors surface per-attachment** (`data-upload-state="error"` on the pill, retried via `.Retry`), never as a global throw. |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `upload` | `(files) => void` | Start uploading files. |
| `remove` | `(id) => void` | Remove an attachment from the pending set. |
| `retry` | `(id) => void` | Retry a failed upload. |
| `clear` | `() => void` | Clear all pending attachments. |

### Prop getters

Both take `(overrides?)` per the standard merge semantics.

| Getter | Spread onto | Description |
| --- | --- | --- |
| `getDropTargetProps` | any surface | Makes it a dropzone (whole-surface, thread-wide if you want); sets `data-dragging` during drag-over. |
| `getAttachInputProps` | `<input type="file">` | The hidden file input the attach button triggers. |

## Example

```tsx
function Composer({ chat }) {
  const upload = useUpload({ api: '/api/uploads', accept: 'image/*', maxFiles: 4 })
  return (
    <div {...upload.getDropTargetProps({ className: 'my-surface' })}>  {/* [data-dragging] to style */}
      <input {...upload.getAttachInputProps()} />
      <ChatInput chat={chat} upload={upload}>
        {upload.attachments.map((a) => (
          <AttachmentPill key={a.id} attachment={a} />
        ))}
        <ChatInput.Field />        {/* paste-to-attach handled by getFieldProps */}
        <ChatInput.Attach />
        <ChatInput.Submit />       {/* submit guards while uploads are in flight */}
      </ChatInput>
    </div>
  )
}
```

## Used by

- [`useChatInput`](./use-chat-input.md) — via the `upload` option: submit folds attachments into the message and guards while uploads are in flight; `getFieldProps` handles paste-to-attach.
- [`ChatInput`](../components/chat-input.md) — `.Root` accepts `upload`; `data-dragging` appears on the drop target.
- [`AttachmentPill`](../components/attachment-pill.md) — renders items from `attachments`.

## Related

- [`useAttachmentPill`](./use-attachment-pill.md) — per-item context reader
- `useAttachments` — the *durable* files hook (server-persisted panel files); `useUpload` is the composer-side pending set

## Note

For durable, server-persisted files see `useAttachments` / `AttachmentsPanel` — a separate surface with the same conventions.
