# useAttachments

Headless state and actions for durable uploaded files.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`useAttachments` owns the durable-file domain: the list of uploaded files, their loading state, and the upload/remove lifecycle. It is the L3 foundation that `AttachmentsPanel` is built on — the hook is sufficient to rebuild the panel verbatim.

> **Renamed:** the old `useUploadsRegistry` alias is **deleted** (breaking-changes ledger). `useAttachments` is the name.

## Import

```tsx
import { useAttachments } from 'veryfront/chat'
```

## Signature

```ts
function useAttachments(options: UseAttachmentsOptions): UseAttachmentsResult

interface UseAttachmentsOptions {
  /** Endpoint for the durable file store. Provide `url` or `transport`. */
  url?: string
  /** Transport object, as an alternative to `url`. */
  transport?: unknown
  /** Scopes persistence, mirroring `ConversationsProvider`'s `storageKey`. */
  storageKey?: string
}

interface UseAttachmentsResult {
  items: UploadedFile[]
  isLoading: boolean
  upload: (files: File[]) => void
  add: (...args: unknown[]) => void
  remove: (id: string) => void
  clear: () => void
  refresh: () => void
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `url` | `string` | The upload/list endpoint. One of `url` or `transport`. |
| `transport` | object | Custom transport, as an alternative to `url`. |
| `storageKey` | `string` | Optional persistence scope. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `items` | `UploadedFile[]` | The durable files. **Error state is per item** — a failed upload surfaces on that item (styled via `data-upload-state="error"` / `data-error` on the row), not as a global `uploadError`. The global `uploadError` is removed (ledger). |
| `isLoading` | `boolean` | Fetch in flight (drives `data-loading` on `AttachmentsPanel.Root`). |

### Actions

| Name | Description |
| --- | --- |
| `upload` | Upload files to the durable store. |
| `add` | Add an item to the list. |
| `remove` | Remove an item. |
| `clear` | Remove all items. |
| `refresh` | Re-fetch the list. |

### Prop getters

The RFC does not define prop getters for this hook — hook state plus your own elements suffice. (Composer-side drop-target and file-input getters live on `useUpload`.)

## Example

```tsx
import { useAttachments } from 'veryfront/chat'

function MyFiles() {
  const { items, isLoading, upload, remove } = useAttachments({ url: '/api/uploads' })

  if (isLoading) return <Spinner />
  return (
    <div className="my-panel">
      <input type="file" onChange={(e) => upload(Array.from(e.target.files ?? []))} />
      <ul>
        {items.map((file) => (
          <li key={file.id}>
            {file.name}
            <button onClick={() => remove(file.id)}>Remove</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

## Used by

- [`AttachmentsPanel`](../components/attachments-panel.md) — every part of the compound is a thin shell over this hook's state.

## Related

- [`useAttachmentsPanel`](../hooks/use-attachments-panel.md) — reads the `AttachmentsPanel` compound's context.
- `useUpload` — composer-side *pending* uploads (`getDropTargetProps`, `getAttachInputProps`); a separate domain from durable files.
