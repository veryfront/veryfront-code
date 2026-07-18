# AttachmentPill

A pending-upload chip for the composer — one per attachment, with thumbnail, label, retry, and remove.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AttachmentPill } from 'veryfront/chat'
```

## Anatomy

`AttachmentPill.Root` renders one `<div>` and provides per-attachment context. It is **render-or-compose**: childless, it renders the default row card; any children replace the default anatomy entirely. `<AttachmentPill>` is shorthand for `<AttachmentPill.Root>`.

```tsx
<AttachmentPill.Root attachment={attachment}>
  <AttachmentPill.Thumbnail />
  <AttachmentPill.Icon />
  <AttachmentPill.Label />
  <AttachmentPill.Retry />
  <AttachmentPill.Remove />
</AttachmentPill.Root>
```

## Parts

Each part renders exactly one node, `extends` its native attributes, and takes `asChild`.

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `AttachmentPill.Root` | `<div>` | `data-upload-state` `data-error` | Chip container + context. Default row card only when childless. |
| `AttachmentPill.Thumbnail` | `<img>` | — | Image preview for image attachments. |
| `AttachmentPill.Icon` | `<span>` | — | File-type icon; default icon when childless, children replace it. |
| `AttachmentPill.Label` | `<span>` | — | File name label. |
| `AttachmentPill.Retry` | `<button>` | — | Retries a failed upload (errors surface per-attachment, not as a global throw). |
| `AttachmentPill.Remove` | `<button>` | — | Removes the attachment from the pending set. |

## Props (`AttachmentPill.Root`)

`extends React.HTMLAttributes<HTMLDivElement>` — `className`, `style`, `data-*`, `aria-*`, handlers, and `ref` all pass through to the single node, with the standard merge semantics.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `asChild` | `boolean` | `false` | Merge onto your own element instead of rendering a `<div>`. |
| `attachment` | `AttachmentInfo` | — | The attachment this pill represents (an item from `useUpload().attachments`). |

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-upload-state="idle\|uploading\|processing\|error\|done"` | `.Root` | Upload lifecycle. |
| `data-error` | `.Root` | The upload errored (style hook alongside `data-upload-state="error"`). |
| `data-disabled` | interactive leaves | Disabled. |

## Examples

### Default (inside `<Chat/>`)

The L1 preset renders pills for pending uploads automatically:

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
```

### Composed (L2)

Map the upload state to pills and compose the anatomy you want:

```tsx
function PendingAttachments({ upload }: { upload: UseUploadResult }) {
  return (
    <div className="my-pill-row">
      {upload.attachments.map((a) => (
        <AttachmentPill key={a.id} attachment={a} className="my-pill">
          <AttachmentPill.Thumbnail className="my-thumb" />
          <AttachmentPill.Label />
          <AttachmentPill.Retry />       {/* shown via [data-upload-state="error"] styling */}
          <AttachmentPill.Remove aria-label="Remove file" />
        </AttachmentPill>
      ))}
    </div>
  )
}
```

### Headless (L3)

Skip the component and map `upload.attachments` to your own chips:

```tsx
function MyChips() {
  const upload = useUpload({ api: '/api/uploads' })
  return (
    <ul>
      {upload.attachments.map((a) => (
        <li key={a.id} data-upload-state={a.state}>
          {a.name}
          <button onClick={() => upload.retry(a.id)}>Retry</button>
          <button onClick={() => upload.remove(a.id)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}
```

## Customization

The pill is per-item: replacing it never touches the composer.

1. **L1 → L2:** compose `AttachmentPill.Root` with your own children — they replace the default row card entirely (no half-hidden chrome).
2. **L2 → L3:** read `useAttachmentPill()` inside the pill, or drop the component and map `useUpload().attachments` yourself.

## Related

- [`useAttachmentPill`](../hooks/use-attachment-pill.md) — the pill's context reader
- [`useUpload`](../hooks/use-upload.md) — owns the pending-attachment list and lifecycle
- [`ChatInput`](./chat-input.md) — the composer these pills accompany
