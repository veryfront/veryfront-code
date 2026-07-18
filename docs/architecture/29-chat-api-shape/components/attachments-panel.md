# AttachmentsPanel

A compound component for browsing and managing durable uploaded files, with the same compositional depth as messages.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`AttachmentsPanel` renders the *durable* file surface — files that persist beyond a single composer submission. (Pending, composer-side uploads are `AttachmentPill`.) Like every component in the library, each part renders exactly one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and accepts `asChild`.

## Import

```tsx
import { AttachmentsPanel } from 'veryfront/chat'
```

## Anatomy

```tsx
<AttachmentsPanel.Root>
  <AttachmentsPanel.Header />
  <AttachmentsPanel.List>
    <AttachmentsPanel.Item>
      <AttachmentsPanel.Icon />
      <AttachmentsPanel.Preview />
      <AttachmentsPanel.Name />
      <AttachmentsPanel.Size />
      <AttachmentsPanel.Remove />
    </AttachmentsPanel.Item>
  </AttachmentsPanel.List>
  <AttachmentsPanel.Loading />
  <AttachmentsPanel.Empty />
  <AttachmentsPanel.Action />
</AttachmentsPanel.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `.Root` | `<div>` | `data-loading` `data-empty` | Panel container. Provides the panel context read by the other parts and by `useAttachmentsPanel()`. |
| `.Header` | `<header>` | — | Panel heading area. |
| `.List` | `<ul>` | — | The file list. |
| `.Item` | `<li>` | `data-upload-state` `data-active` `data-error` | One file row. **Render-or-compose:** renders the default row anatomy when childless; any children replace it entirely — there is no half-hidden row card. |
| `.Icon` | `<span>` | — | File-type icon. Renders its default icon when childless; pass children to replace it (no `icon` prop). |
| `.Preview` | `<img>` | — | Image preview for the file. |
| `.Name` | `<span>` | — | File name (added via #2975). |
| `.Size` | `<span>` | — | File size (added via #2975). |
| `.Remove` | `<button>` | — | Removes the file. |
| `.Loading` | `<div>` | — | Shown while the panel is fetching. |
| `.Empty` | `<div>` | — | Shown when there are zero files. |
| `.Action` | `<button>` | — | Panel-level action button. |

## Props

Every part follows the library-wide node contract:

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the part's behaviour and attributes onto your own child element instead of rendering the default node. |
| `className` | `string` | Merged Tailwind-aware with the variant defaults (consumer classes win). |
| `ref` | `Ref` | Composed with internal refs; reaches the rendered node. |
| …native attributes | — | Each part `extends React.HTMLAttributes` of its node — `style`, `data-*`, `aria-*`, event handlers, `id`, everything spreads through. Consumer event handlers run first; `event.preventDefault()` cancels the internal handler. |

Behaviour and data come from [`useAttachments`](../hooks/use-attachments.md); the compound's parts read it through the panel context (see [`useAttachmentsPanel`](../hooks/use-attachments-panel.md)).

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-loading` | `.Root` | Fetch in flight. |
| `data-empty` | `.Root` | Zero items. |
| `data-upload-state="idle \| uploading \| processing \| error \| done"` | `.Item` | Upload lifecycle. |
| `data-active` | `.Item` | Selected item. |
| `data-error` | `.Item` | The row's file errored. Errors are per-item — there is no global upload error. |

Style with CSS or Tailwind variants (e.g. `data-[upload-state=error]:border-red-500`) — state is never exposed as boolean styling props.

## Examples

### Default

Childless parts render their default anatomy.

```tsx
<AttachmentsPanel.Root>
  <AttachmentsPanel.Header>Files</AttachmentsPanel.Header>
  <AttachmentsPanel.List />
  <AttachmentsPanel.Loading>Loading files…</AttachmentsPanel.Loading>
  <AttachmentsPanel.Empty>No files yet</AttachmentsPanel.Empty>
</AttachmentsPanel.Root>
```

### Composed

You own every layout div. Map `items` from the hook and compose each row from the leaves — children of `.Item` replace the default row entirely.

```tsx
import { AttachmentsPanel, useAttachments } from 'veryfront/chat'

function FilesPanel() {
  const attachments = useAttachments({ url: '/api/uploads' })

  return (
    <AttachmentsPanel.Root className="rounded-lg border">
      <AttachmentsPanel.Header className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Files</h2>
        <AttachmentsPanel.Action>Upload</AttachmentsPanel.Action>
      </AttachmentsPanel.Header>

      <AttachmentsPanel.List className="divide-y">
        {attachments.items.map((file) => (
          <AttachmentsPanel.Item
            key={file.id}
            className="flex gap-3 p-2 data-[upload-state=error]:bg-red-50"
          >
            <AttachmentsPanel.Preview className="size-10 rounded" />
            <div className="min-w-0 flex-1">        {/* your layout div */}
              <AttachmentsPanel.Name className="truncate" />
              <AttachmentsPanel.Size className="text-muted-foreground" />
            </div>
            <AttachmentsPanel.Remove aria-label="Remove file" />
          </AttachmentsPanel.Item>
        ))}
      </AttachmentsPanel.List>

      <AttachmentsPanel.Empty>Drop files anywhere to upload</AttachmentsPanel.Empty>
    </AttachmentsPanel.Root>
  )
}
```

### Headless

Skip the compound entirely — [`useAttachments`](../hooks/use-attachments.md) is the same state the panel is built on. You render every element.

```tsx
import { useAttachments } from 'veryfront/chat'

function MyFiles() {
  const { items, isLoading, remove } = useAttachments({ url: '/api/uploads' })

  if (isLoading) return <Spinner />
  return (
    <ul className="my-file-grid">
      {items.map((file) => (
        <li key={file.id} className="my-file-card">
          <span>{file.name}</span>
          <button onClick={() => remove(file.id)}>Remove</button>
        </li>
      ))}
    </ul>
  )
}
```

## Customization

The eject path is **per-item** — the panel chrome never holds the data hostage:

1. **Restyle a row** — pass children to `.Item`; they replace the default anatomy entirely, and each leaf is one node you can class, attribute, or swap via `asChild`.
2. **Own the iteration** — map `useAttachments().items` yourself inside `.List` (or without the panel at all).
3. **Full headless** — `useAttachments` returns the complete state and actions; render any markup.

Replacing an item never forces ejecting the panel; replacing the panel never forces re-implementing the upload state.

## Related

- [`useAttachments`](../hooks/use-attachments.md) — durable-file state and actions (the L3 hook underneath).
- [`useAttachmentsPanel`](../hooks/use-attachments-panel.md) — the compound's context reader.
- `AttachmentPill` — the composer-side chip for *pending* uploads (a separate component; see the RFC).
