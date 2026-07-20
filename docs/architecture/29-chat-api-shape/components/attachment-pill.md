# AttachmentPill

A pending-upload chip for the composer — one per attachment, with thumbnail, label, retry, and remove.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AttachmentPill } from 'veryfront/chat'
```

## Parts index

- [`.Root`](#attachmentpillroot--changed) — `changed`: lifecycle surfaces as `data-upload-state` / `data-error`
- [`.Thumbnail`](#attachmentpillthumbnail--changed) — `changed`: wrapper `<div>` + `<img>` → one `<img>` (TBD)
- [`.Icon`](#attachmentpillicon--changed) — `changed`: `<div>` → `<span>` (TBD)
- [`.Label`](#attachmentpilllabel--changed) — `changed`: `<div>` → `<span>` (TBD)
- [`.Retry`](#attachmentpillretry--changed) — `changed`: `icon` prop removed
- [`.Remove`](#attachmentpillremove--changed) — `changed`: `icon` prop removed

## Anatomy

`AttachmentPill.Root` renders one `<div>` and provides per-attachment context. It is **render-or-compose** (already true in today's implementation): childless, it renders the default row card; any children replace the default anatomy entirely. `<AttachmentPill>` is shorthand for `<AttachmentPill.Root>`.

```tsx
<AttachmentPill.Root attachment={attachment}>  {/* one <div> · data-upload-state · data-error */}
  <AttachmentPill.Thumbnail />  {/* image square · only for non-error images with a source */}
  <AttachmentPill.Icon />       {/* state glyph / extension badge · the non-image square */}
  <AttachmentPill.Label />      {/* name + state line column · truncates, fills the row */}
  <AttachmentPill.Retry />      {/* only in the error state with a retry handler */}
  <AttachmentPill.Remove />     {/* only with a remove handler · hover-reveal on md+ */}
</AttachmentPill.Root>
```

In the *default* anatomy, `.Thumbnail` and `.Icon` are mutually exclusive: the pill renders `.Thumbnail` when the attachment resolves to a non-error image with a source, else `.Icon`. Composed, you may include both — each null-guards itself (`.Thumbnail` renders `null` without an image source; `.Icon` always renders).

## Default DOM (childless render)

The actual rendered HTML of the default chip, annotated with the part each node is and its layout mechanics (classes from source).

```html
<!-- .Root — ONE flex row: relative flex items-center gap-3 py-1 pl-1 pr-2.
     `group` exists for the Remove hover-reveal; `relative` is NOT used for any card-level
     overlay — nothing is ever absolutely positioned over the whole chip.
     border variants: default border-[var(--edge-medium)] · selected → border-dashed ·
     error → border-[var(--destructive)] + tinted bg · bordered={false} → no border.
     No width of its own — width is the container's decision (composer passes w-[200px]). -->
<div class="group relative flex items-center gap-3 rounded-[var(--radius-md)] border
            border-[var(--edge-medium)] bg-[var(--secondary)] py-1 pl-1 pr-2">

  <!-- .Thumbnail — ONLY for non-error images with a src. In-flow first flex child:
       size-10 shrink-0 (fixed square, never squeezed) — it sits left because it is
       FIRST IN DOM ORDER, not floated. `relative overflow-hidden` = its own
       positioning context + rounded clipping for the img. -->
  <div class="relative size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--tertiary)]">
    <img alt="" class="size-full object-cover" src="…" />
    <!-- busy overlay — ONLY while uploading/processing; absolute inset-0 INSIDE the
         thumbnail's own relative square (never over the card); centers a spinner -->
    <div class="absolute inset-0 flex items-center justify-center bg-[var(--overlay)]">
      <span class="size-4 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
    </div>
  </div>

  <!-- .Icon — the non-image alternative (same slot, same square): size-10 shrink-0,
       flex-centered content = state glyph OR uppercase extension text; bg/fg from state
       (error → destructive tint) or file-type color map. Legacy `status="uploading"` adds
       the same absolute inset-0 spinner overlay INSIDE this square. -->
  <div class="relative flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)]
              text-[10px] font-medium uppercase leading-none">pdf</div>

  <!-- .Label — min-w-0 flex-1: the ONLY growing child, so it fills the row and pushes the
       action buttons to the end; min-w-0 lets both lines truncate instead of widening the chip.
       Vertical: flex-col gap-0.5, two <p> lines, each `truncate`. -->
  <div class="flex min-w-0 flex-1 flex-col gap-0.5">
    <p class="truncate text-sm font-medium leading-tight">report.pdf</p>          <!-- shimmers while busy -->
    <p class="truncate text-xs leading-tight text-[var(--faint)]">240 KB</p>       <!-- state line -->
  </div>

  <!-- .Retry — ONLY when state="error" AND an onRetry handler exists; shrink-0 at row end -->
  <button class="shrink-0" aria-label="Retry report.pdf">⟳</button>

  <!-- .Remove — ONLY when an onRemove handler exists (and not legacy-uploading); shrink-0,
       last in the row. Hover-reveal: opacity-100 md:opacity-0 md:group-hover:opacity-100 —
       always visible on touch, revealed by hovering the .Root `group` on md+ -->
  <button class="shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100"
          aria-label="Remove report.pdf">✕</button>
</div>
```

Key mechanics: the parts are **in-flow flex children in DOM order** — square left, label growing in the middle (`min-w-0 flex-1` is what pushes the actions right), actions `shrink-0` at the end. The only absolute elements are the busy-spinner overlays, each `inset-0` inside its *own* square's `relative` box — never over the card.

## Parts

Each part renders exactly one node, `extends` its native attributes, and takes `asChild` *(proposed — today the sub-parts accept only `className`, plus `icon` on `.Retry`/`.Remove`, which the proposal **removes** in favor of children)*.

### `AttachmentPill.Root` — `changed`

**Changed:** the upload lifecycle — today baked into classes — surfaces as `data-upload-state` / `data-error`.

The chip container — one `<div>` — plus the per-attachment context (`useAttachmentPill`). Childless, it renders the default row card: `Thumbnail`-or-`Icon` → `Label` → `Retry` → `Remove`; any children replace that anatomy entirely (no half-hidden chrome).

**Layout:** one horizontal flex row (`relative flex items-center gap-3 py-1 pl-1 pr-2`); `group` enables the Remove hover-reveal; deliberately no width — the container decides (fixed chip in the composer, full row in `AttachmentsPanel`).

`extends React.HTMLAttributes<HTMLDivElement>` — `className`, `style`, `data-*`, `aria-*`, handlers, and `ref` all pass through to the single node, with the standard merge semantics (`className` merged last).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `asChild` *(proposed)* | `boolean` | `false` | Merge onto your own element instead of rendering a `<div>`. |
| `attachment` *(required)* | `AttachmentInfo` | — | The attachment this pill represents (an item from `useUpload().attachments`): `{ id, name, state?, progress?, type?, size?, preview?, url?, status? }`. |
| `onRemove` | `(id: string) => void` | — | Enables `.Remove`. **TBD:** the proposal routes remove/retry through `useUpload` context, which would make these props optional overrides. |
| `onRetry` | `(id: string) => void` | — | Enables `.Retry` in the error state. |
| `bordered` | `boolean` | `true` | `false` = flat, borderless row (used by `AttachmentsPanel`). **TBD:** survives, or is replaced by styling off `data-*`. |

**State attributes (proposed):** `data-upload-state="idle|uploading|processing|error|done"` · `data-error`. Today the lifecycle is expressed only through baked-in classes (dashed border for `selected`, destructive tint for `error`, shimmer while busy); the RFC surfaces it as `data-*`. **Note a vocabulary mismatch to resolve:** the source `AttachmentState` is `'selected' | 'uploading' | 'processing' | 'uploaded' | 'error'`, while the proposed attribute uses `idle`/`done` — presumably `selected → idle`, `uploaded → done`, but the mapping is TBD. The legacy two-value `status: 'uploading' | 'ready'` field (and its 70%-opacity dimming) is expected to be dropped — TBD.

### `AttachmentPill.Thumbnail` — `changed`

The image square. Today it renders a `<div>` wrapper (`relative overflow-hidden`, rounded, `bg tertiary`) containing an `<img alt="" class="size-full object-cover">` plus, while busy, an `absolute inset-0` spinner overlay; the proposed parts table lists it as one `<img>` — reconciling the wrapper-vs-single-node shape (the overlay needs the wrapper) is TBD.

**Layout:** fixed `size-10 shrink-0` square, in-flow first flex child; its `relative` box scopes the busy overlay to the square only.

**Renders `null` when the attachment has no image source or is in the error state.** The source is `preview` (local object-URL) falling back to `url` (resolved after upload), for attachments whose media type or filename matches an image.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` *(proposed)* + native + `ref` | | Today accepts only `className`. |

### `AttachmentPill.Icon` — `changed`

The non-image square — a state glyph or file-type badge. Today one `<div>` (proposed parts table says `<span>` — TBD). Default content, in priority order: the **state glyph** when a lifecycle `state` is set (`selected` → clock, `uploading` → spinner, `processing` → file icon, `uploaded` → check, `error` → alert glyph), else the **uppercase file extension** (colored by type: pdf red, docx blue, csv emerald, md/mdx purple, txt neutral), else `"file"`. Error state swaps to a destructive-tinted box. **Always renders** (the default anatomy shows it only when `.Thumbnail` doesn't apply). Children *(proposed)* replace the glyph/badge.

**Layout:** fixed `size-10 shrink-0` flex-centered square; `relative` scopes the legacy-uploading spinner overlay (`absolute inset-0`) to itself.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` *(proposed)* + native + `ref` | | Today accepts only `className`. |

### `AttachmentPill.Label` — `changed`

The two-line text column. Today one `<div>` (proposed parts table says `<span>` — TBD). Default content: line 1 = the file name (`attachment.name`, falling back to `"Attachment"`), shimmering while uploading/processing; line 2 = the state line — `"Ready to upload"` (selected) · `"Uploading · N%"` (with `progress`) · `"Processing document"` · `"Uploaded · 1.2 MB"` · `"Upload failed. Try again."` (error, destructive color) · else the file size or uppercase extension. Both lines truncate. **Always renders.**

**Layout:** `min-w-0 flex-1` — the only growing child; it fills the row (pushing `.Retry`/`.Remove` to the end) and truncates instead of widening the chip.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` *(proposed)* + native + `ref` | | Today accepts only `className`; children *(proposed)* replace both lines (use `useAttachmentPill()`). |

### `AttachmentPill.Retry` — `changed`

**Changed:** the `icon` prop is removed — children replace the default glyph.

The retry control — one `<button>`, `aria-label="Retry {name}"`. Default content: refresh icon. Retries a failed upload; errors surface per-attachment, not as a global throw. **Renders `null` unless the state is `error` *and* a retry handler is available** — safe to include unconditionally.

**Layout:** `shrink-0` in-flow flex child near the row end; always visible when rendered (no hover gating).

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` *(proposed)* + native + `ref` | | Children replace the default icon. |
| `icon` *(removed)* | `React.ReactNode` | Replaced by children. |

### `AttachmentPill.Remove` — `changed`

**Changed:** the `icon` prop is removed — children replace the default glyph.

The remove (✕) control — one `<button>`, `aria-label="Remove {name}"`. Default content: X glyph. Removes the attachment from the pending set. **Renders `null` when no remove handler is available** (today also during a legacy `status="uploading"`).

**Layout:** `shrink-0`, last flex child; hover-revealed on md+ (`opacity-100 md:opacity-0 md:group-hover:opacity-100`, driven by the Root's `group`), always visible on touch widths.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` *(proposed)* + native + `ref` | | Children replace the default X glyph. |
| `icon` *(removed)* | `React.ReactNode` | Replaced by children. |

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-upload-state="idle\|uploading\|processing\|error\|done"` | `.Root` | Upload lifecycle (vocabulary vs. today's `AttachmentState` — see `.Root`). |
| `data-error` | `.Root` | The upload errored (style hook alongside `data-upload-state="error"`). |
| `data-disabled` | interactive leaves | Disabled. |

## Context (what the parts read)

`useAttachmentPill()` — throws outside `AttachmentPill.Root`. Proposed shape:

```ts
{
  attachment: AttachmentInfo
  state: 'idle' | 'uploading' | 'processing' | 'error' | 'done'
  retry(): void
  remove(): void
}
```

Today's context is richer — it also exposes the derived presentation fields the default parts consume (`ext`, `isImage`, `imageSrc`, `isError`, `isBusy`, `shimmerTitle`, `label`, `stateGlyph`, `boxClass`, `colorClass`, `legacyUploading`). Whether those stay public or become internal to the default parts is TBD.

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
