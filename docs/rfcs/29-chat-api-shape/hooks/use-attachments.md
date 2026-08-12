# useAttachments

Headless state and actions for durable uploaded files.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useAttachments`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **✂ Earns-its-place flag** (see [proposed v1 scope cuts](../../29-chat-api-shape.md)): owns the durable-list domain that rides with [`AttachmentsPanel`](../components/attachments-panel.md) - proposed for the same optional module, not core v1. Also the clearest proliferation smell: `useUpload` (pending) and `useAttachments` (durable) have near-identical shapes; consider collapsing toward one transport-pluggable primitive parameterized by persistence.

`useAttachments` owns the durable-file domain: the list of uploaded files, their loading state, and the upload/remove lifecycle. It is the L3 foundation that `AttachmentsPanel` is built on - the hook is sufficient to rebuild the panel verbatim.

> **Renamed:** the old `useUploadsRegistry` alias is **deleted** (breaking-changes ledger). `useAttachments` is the name.

## Import

```tsx
import { useAttachments } from "veryfront/chat";
```

## Signature

```ts
function useAttachments(options: UseAttachmentsOptions): UseAttachmentsResult;

interface UseAttachmentsOptions {
  /** Endpoint for the durable file store. Provide `url` or `transport`. */
  url?: string;
  /** Transport object, as an alternative to `url`. */
  transport?: AttachmentsTransport;
  /** Scopes persistence, mirroring `ConversationsProvider`'s `storageKey`. */
  storageKey?: string;
}

interface UseAttachmentsResult {
  items: UploadedFile[];
  isLoading: boolean;
  upload: (files: File[]) => Promise<UploadedFile[]>;
  add: (item: UploadedFile) => void;
  remove: (id: string) => Promise<void>;
  clear: () => void;
  refresh: () => Promise<void>;
}

interface AttachmentsTransport {
  list(): Promise<UploadedFile[]>;
  upload(files: File[]): Promise<UploadedFile[]>;
  remove(id: string): Promise<void>;
  refresh?(): Promise<UploadedFile[]>;
}
```

## Options

| Option       | Type                   | Description                                            |
| ------------ | ---------------------- | ------------------------------------------------------ |
| `url`        | `string`               | The upload/list endpoint. One of `url` or `transport`. |
| `transport`  | `AttachmentsTransport` | Custom transport, as an alternative to `url`.          |
| `storageKey` | `string`               | Optional persistence scope.                            |

## Returns

### State

| Name        | Type             | Description                                                                                                                                                                                                                             |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items`     | `UploadedFile[]` | The durable files. **Error state is per item** - a failed upload surfaces on that item (styled via `data-upload-state="error"` / `data-error` on the row), not as a global `uploadError`. The global `uploadError` is removed (ledger). |
| `isLoading` | `boolean`        | Fetch in flight (drives `data-loading` on `AttachmentsPanel.Root`).                                                                                                                                                                     |

### Actions

| Name      | Description                               |
| --------- | ----------------------------------------- |
| `upload`  | Upload files to the durable store.        |
| `add`     | Add an already-resolved item to the list. |
| `remove`  | Remove an item.                           |
| `clear`   | Remove all items.                         |
| `refresh` | Re-fetch the list.                        |

### Prop getters

The RFC does not define prop getters for this hook - hook state plus your own elements suffice. (Composer-side drop-target and file-input getters live on `useUpload`.)

## Example

```tsx
import { useAttachments } from "veryfront/chat";

function MyFiles() {
  const { items, isLoading, upload, remove } = useAttachments({ url: "/api/uploads" });

  if (isLoading) return <Spinner />;
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
  );
}
```

## Used by

- [`AttachmentsPanel`](../components/attachments-panel.md) - every part of the compound is a thin shell over this hook's state.

## Related

- [`useAttachmentsPanel`](../hooks/use-attachments-panel.md) - reads the `AttachmentsPanel` compound's context.
- `useUpload` - composer-side _pending_ uploads (`getDropTargetProps`, `getAttachInputProps`); a separate domain from durable files.
