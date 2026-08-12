# useAttachmentPill

Context reader for a single pending attachment inside an `AttachmentPill`.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useAttachmentPill`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAttachmentPill } from "veryfront/chat";
```

## Signature

```ts
function useAttachmentPill(): {
  attachment: AttachmentInfo;
  state: "idle" | "uploading" | "processing" | "error" | "done";
  retry: () => void;
  remove: () => void;
};
```

A context reader: it reads the attachment provided by the nearest `AttachmentPill.Root`. The _list_ of attachments comes from [`useUpload().attachments`](./use-upload.md) - this hook is per-item. `retry()`/`remove()` route through the Root's `upload?: UseUploadResult` prop, which defaults to the nearest `ChatInput` context's upload (explicit prop > nearest context) - so inside a composer, no handler wiring is needed.

## Options

None.

## Returns

### State

| Name         | Type                                                         | Description                                                                  |
| ------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `attachment` | `AttachmentInfo`                                             | The attachment this pill represents.                                         |
| `state`      | `'idle' \| 'uploading' \| 'processing' \| 'error' \| 'done'` | Upload lifecycle (mirrored as `data-upload-state` on `AttachmentPill.Root`). |

### Actions

| Name     | Type         | Description                                                                                                                          |
| -------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `retry`  | `() => void` | Retry this attachment's failed upload. Routes through the Root's `upload` (default: the nearest `ChatInput` context's upload).       |
| `remove` | `() => void` | Remove this attachment from the pending set. Routes through the Root's `upload` (default: the nearest `ChatInput` context's upload). |

### Prop getters

None - the pill's leaves are display and simple buttons; hook state plus your own element suffice.

## Example

A custom leaf inside a pill - behavior from context, markup yours:

```tsx
function UploadProgressBadge(props: React.HTMLAttributes<HTMLSpanElement>) {
  const { state, retry } = useAttachmentPill();
  if (state === "error") {
    return <button type="button" onClick={retry}>Upload failed - retry</button>;
  }
  return <span {...props}>{state}</span>;
}

<AttachmentPill attachment={a}>
  <AttachmentPill.Label />
  <UploadProgressBadge className="my-badge" />
  <AttachmentPill.Remove />
</AttachmentPill>;
```

For fully custom chips, skip the component and map `useUpload().attachments` directly - see [`useUpload`](./use-upload.md).

## Used by

- [`AttachmentPill`](../components/attachment-pill.md) - `.Retry` and `.Remove` are thin shells over this hook's actions; `.Root` provides the context it reads.

## Related

- [`useUpload`](./use-upload.md) - owns the attachment list and lifecycle
- [`AttachmentPill`](../components/attachment-pill.md)
- [`ChatInput`](../components/chat-input.md)
