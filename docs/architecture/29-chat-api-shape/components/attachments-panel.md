# AttachmentsPanel

A compound component for browsing and managing durable uploaded files, with the same compositional depth as messages.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`AttachmentsPanel` renders the *durable* file surface — files that persist beyond a single composer submission. (Pending, composer-side uploads are `AttachmentPill`.) Like every component in the library, each part renders exactly one node, `extends` the native attributes of that node, spreads `{...props}` onto it, and accepts `asChild`. It is **render-or-compose** (like `ToolCall` / `Sources`): `<AttachmentsPanel />` with no children renders the full default anatomy; children replace it.

## Import

```tsx
import { AttachmentsPanel } from 'veryfront/chat'

// Every sub-part is also a flat named export, with its props interface:
import { AttachmentsPanel, AttachmentsPanelItemName, type AttachmentsPanelItemNameProps } from 'veryfront/chat'
```

## Parts index

- [`.Root`](#attachmentspanelroot--changed) — `changed`: `loading` boolean → `data-loading` / `data-empty`; `uploads` defaults from `useAttachments`
- [`.Header`](#attachmentspanelheader--changed) — `changed`: `<div>` → `<header>`
- [`.List`](#attachmentspanellist--changed) — `changed`: `<div>` → `<ul>`
- [`.Item`](#attachmentspanelitem--changed) — `changed`: pill `<div>` → `<li>`; `data-upload-state` / `data-active` / `data-error` proposed
- [`.Item.Icon`](#attachmentspanelitemicon--changed) — `changed`: `<div>` → `<span>`
- [`.Item.Preview`](#attachmentspanelitempreview--changed) — `changed`: wrapper square → one `<img>`
- [`.Item.Name`](#attachmentspanelitemname-proposed--2975--new) — `new`: no source today (#2975)
- [`.Item.Size`](#attachmentspanelitemsize-proposed--2975--new) — `new`: no source today (#2975)
- [`.Item.Remove`](#attachmentspanelitemremove--changed) — `changed`: `icon` prop deleted
- [`.Loading`](#attachmentspanelloading--changed) — `changed`: self-gates on fetch state (today Root-gated)
- [`.Empty`](#attachmentspanelempty--changed) — `changed`: self-gates on zero files (today Root-gated)
- [`.Action`](#attachmentspanelaction--changed) — `changed`: centering wrapper dropped — one `<button>`; `variant` fate TBD

## Anatomy

```tsx
<AttachmentsPanel.Root>            {/* <div> panel column · data-loading · data-empty (proposed) */}
  <AttachmentsPanel.Header />      {/* <header> — "Attachments" title + close button (when onClose) */}
  <AttachmentsPanel.List>          {/* <ul> — one .Item per file + trailing .Action (when onAttach) */}
    <AttachmentsPanel.Item>        {/* <li> — one file row · data-upload-state · data-active · data-error (proposed) */}
      <AttachmentsPanel.Item.Icon />     {/* <span> — file-type / state square (when not an image) */}
      <AttachmentsPanel.Item.Preview />  {/* <img> — image thumbnail; null for non-images */}
      <AttachmentsPanel.Item.Name />     {/* <span> — file name (proposed, #2975) */}
      <AttachmentsPanel.Item.Size />     {/* <span> — formatted byte size (proposed, #2975) */}
      <AttachmentsPanel.Item.Remove />   {/* <button> — delete; null without a remove handler */}
    </AttachmentsPanel.Item>
  </AttachmentsPanel.List>
  <AttachmentsPanel.Loading />     {/* <div> — skeleton rows while the list fetches */}
  <AttachmentsPanel.Empty />       {/* <div> — zero-files state, centered */}
  <AttachmentsPanel.Action />      {/* <button> — opens the native file picker */}
</AttachmentsPanel.Root>
```

`<AttachmentsPanel.Root>` with **no children renders the default anatomy**: `.Header` (when `onClose` is set), then a scroll region holding `.List` (when there are files), `.Loading` (no files yet + still loading), or `.Empty`.

## Default DOM (childless render)

What `<AttachmentsPanel uploads={…} onRemoveUpload={…} onAttach={…} onClose={…} />` actually renders today (classes abbreviated to layout):

```html
<style>…</style>  <!-- <ChatTokens/> — the [data-vf-ui]-scoped token stylesheet, rendered as a sibling just before the root -->
<div data-vf-ui data-vf-chat class="flex flex-col h-full">              <!-- .Root — vertical flex column, fills parent height; carries the token-scope attributes (canonical data-vf-ui + data-vf-chat compat alias) — load-bearing for portal anchoring: portalled content (the ⋯ menu popover) re-establishes the scope via closest('[data-vf-ui],[data-vf-chat]') -->
  <div class="flex shrink-0 items-center justify-between px-4 pt-4">    <!-- .Header — fixed row above the scroll area; only mounted when onClose is set -->
    <h2>Attachments</h2>
    <button aria-label="Close attachments">✕</button>                   <!-- in-flow; pushed right by justify-between, not absolute -->
  </div>
  <div class="flex-1 overflow-y-auto px-4 py-4">                        <!-- internal scroll region (today NOT an addressable part — see .List note) -->
    <div class="mx-auto flex max-w-2xl flex-col gap-2">                 <!-- .List — centered column, capped at max-w-2xl, 8px row gap -->
      <!-- one per upload: -->
      <div class="group relative flex items-center gap-3 w-full py-1 pl-1 pr-2 rounded">  <!-- .Item — in-flow horizontal flex row (an AttachmentPill root, borderless) -->
        <div class="relative size-10 shrink-0 rounded">…</div>          <!-- icon OR thumbnail square — fixed 40px, never shrinks; the square is its own relative box, and the busy spinner overlays it absolute inset-0 (within the square, not the row) while uploading/processing -->
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">              <!-- label column — takes remaining width; min-w-0 enables truncation -->
          <p class="truncate">report.pdf</p>                            <!-- name line, single-line ellipsis -->
          <p class="truncate">120 KB</p>                                <!-- size/state line, single-line ellipsis -->
        </div>
        <button class="shrink-0" aria-label="Actions for report.pdf">⋯</button>  <!-- overflow menu trigger — in-flow flex child, always visible (no hover-reveal); its popover content is portalled, not in the row -->
      </div>
      <div class="flex justify-center pt-2">                            <!-- .Action variant="more" — today wraps the button in a centering div -->
        <button>Upload files</button>
      </div>
    </div>
    <!-- with zero uploads the scroll region instead holds ONE of: -->
    <!-- .Loading (loading + no files): column of 3 item-shaped skeleton rows, aria-busy -->
    <!-- .Empty: flex flex-col items-center justify-center h-full — centers in the scroll region -->
  </div>
  <input type="file" multiple style="position:absolute; …clip:rect(0,0,0,0)" />  <!-- hidden native picker — visually-hidden absolute; mounted only when onAttach is set -->
</div>
```

Layout facts a reviewer should not have to open source for: the default row's trailing control is an **overflow `⋯` menu** (Open / Delete), not `.Remove` — `.Remove` appears when you compose the row; every row control is **in-flow** (nothing in the row is absolutely positioned except the transient busy spinner, which overlays the 40px media square *within the square's own `relative` box*, not the row); nothing is hover-revealed; today the **scroll region is an anonymous div** between `.Root` and `.List` — under the proposed one-node shape, TBD whether overflow moves onto `.List` or stays a Root-owned region.

## Parts

Every part accepts `asChild`, merges `className` Tailwind-aware (consumer wins), composes `ref`s, and spreads native attributes of its node; consumer event handlers run first and `event.preventDefault()` cancels the internal handler.

### `AttachmentsPanel.Root` — `changed`

**Changed:** the `loading` boolean gives way to `data-loading` / `data-empty`, with `uploads` defaulting from `useAttachments` context.

The panel container + the compound's scoped context (read by every part and by `useAttachmentsPanel()`). Renders one `<div>` (today; column via `flex flex-col h-full`) plus, when `onAttach` is set, the visually-hidden `<input type="file" multiple>` that `.Action` triggers.

**Layout:** vertical flex column that fills its parent's height; header pinned (`shrink-0`), scroll region takes the rest (`flex-1 overflow-y-auto`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `uploads` | `UploadedFile[]` (`{ id, name, size?, type?, url? }`) | `[]` | The files to list. **Proposed:** defaults from [`useAttachments`](../hooks/use-attachments.md) context; explicit prop overrides (TBD — plan states the hook is the source; prop-override precedence not yet specified) |
| `loading` | `boolean` | `false` | Today: with zero uploads, shows `.Loading` instead of `.Empty`. **Proposed:** the boolean styling surface is replaced by `data-loading` reflecting `useAttachments().isLoading`; whether a controlled boolean override survives is TBD |
| `onRemoveUpload` | `(id: string) => void` | — | Wired to `.Remove` and the default row's Delete menu entry; when absent both null-render |
| `onAttach` | `(files: FileList) => void` | — | Receives picked files; also gates the hidden input, `.Action` in the default anatomy, and the Empty-state upload button |
| `attachAccept` | `string` | — | `accept` for the native picker |
| `onClose` | `() => void` | — | Dismisses the panel; gates `.Header` in the default anatomy and its close button |
| `asChild` | `boolean` | `false` | Merge onto your own element |
| + native | `React.HTMLAttributes<HTMLDivElement>` · `ref` | — | Spread onto the single node; `className` merges |

**State attributes (proposed):** `data-loading` (fetch in flight) · `data-empty` (zero items). Today neither exists — loading/empty are presented only by which child the default anatomy mounts.

### `AttachmentsPanel.Header` — `changed`

One node — today a `<div>`, **proposed `<header>`**. Default content: an `<h2>` reading **"Attachments"** and, when `onClose` is set, a `ui` icon `Button` (✕, `aria-label="Close attachments"`) that calls it. Children replace both.

**Layout:** in-flow `shrink-0` flex row pinned above the scroll region; title left, close button pushed right via `justify-between` (in-flow, not absolute).

**Render conditions:** in the default anatomy, mounted only when `onClose` is set. Rendered explicitly it always mounts; only the close button is gated on `onClose`.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default title + close button |

### `AttachmentsPanel.List` — `changed`

One node — today a `<div>`, **proposed `<ul>`**. Default content: one `.Item` per upload, plus the "Upload files" `.Action` (`variant="more"`) underneath when `onAttach` is set. Children replace the mapping entirely (own the iteration).

**Layout:** centered column (`mx-auto max-w-2xl`), `flex-col gap-2`. Today it does **not** scroll itself — it sits inside Root's anonymous scroll region (see Default DOM); proposed owner of overflow: TBD.

**Render conditions:** in the default anatomy, mounted only when there is at least one upload. Rendered explicitly it always mounts (zero uploads → just the trailing `.Action`, or nothing).

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default `.Item` mapping (map `useAttachments().items` yourself) |

### `AttachmentsPanel.Item` — `changed`

One file row — today implemented as a borderless [`AttachmentPill`](#context-what-the-parts-read) root `<div>` stretched `w-full`; **proposed `<li>`**. **Render-or-compose:** childless, it renders the default row anatomy — media square (image `Thumbnail` when the file resolves to an image, file-type `Icon` otherwise) → name + size label column → trailing overflow `⋯` menu (**Open** when `file.url` exists, **Delete** when `onRemoveUpload` is set; the menu null-renders when neither applies). Any children replace that row entirely — there is no half-hidden row card.

**Layout:** in-flow horizontal flex row (`flex items-center gap-3`, `relative` on the row today via the pill root); fixed 40px `shrink-0` media square, `min-w-0 flex-1` label column (enables truncation), `shrink-0` in-flow trailing control — nothing hover-revealed, nothing absolute except the transient busy spinner, which positions against the media square's **own `relative` box**, not the row.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `file` *(required)* | `UploadedFile` | — | The row's file; provides the per-item context the `Item.*` leaves read |
| `asChild` + native (`HTMLAttributes`, `ref`) | | | Own the node; children replace the default row anatomy |

**State attributes (proposed):** `data-upload-state="idle | uploading | processing | error | done"` (upload lifecycle) · `data-active` (selected item) · `data-error` (this row's file errored — errors are per-item; there is no global upload error). Today none exist; lifecycle is presented only visually by the pill (spinner / check / alert glyph).

### `AttachmentsPanel.Item.Icon` — `changed`

The file-type square shown when there is no image thumbnail — today delegates to `AttachmentPill.Icon`, a 40px `<div>` (**proposed `<span>`**) showing the state glyph (clock / spinner / check / alert) when an upload lifecycle state is set, otherwise the uppercase file-extension badge with a per-type color. Renders its default icon when childless; pass children to replace it (**no `icon` prop** — the icon-slot-prop pattern is banned RFC-wide).

**Layout:** fixed `size-10 shrink-0` in-flow flex child and its own `relative` box; the legacy-uploading spinner overlays it `absolute inset-0` within the square.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default glyph/extension |

### `AttachmentsPanel.Item.Preview` — `changed`

The image thumbnail — today delegates to `AttachmentPill.Thumbnail`: a 40px square wrapping an `<img alt="" class="object-cover">` (**proposed: one `<img>`**), with an `absolute inset-0` spinner overlay while uploading/processing. **Renders `null` when the file is not an image (no resolvable `preview`/`url` src) or is in the error state** — safe to include alongside `.Icon` unconditionally.

**Layout:** fixed `size-10 shrink-0` in-flow flex child; `overflow-hidden` crop; busy overlay absolute within the square.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`ImgHTMLAttributes`, `ref`) | | Own the node |

### `AttachmentsPanel.Item.Name` *(proposed — #2975)* — `new`

One `<span>`: the file's name, truncating. Does not exist today — today the source deliberately omits it (name is "plain text with no attachment-domain logic", read from the item context and rendered yourself, or via `AttachmentPill.Label` which renders a name + secondary line column). #2975 adds it so the default row is fully recomposable from leaves. Default content: `file.name`.

**Layout:** in-flow text span; place it in your own `min-w-0` column to get truncation (see the Composed example).

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Convention only — the shared node contract; no part-specific props are proposed |

### `AttachmentsPanel.Item.Size` *(proposed — #2975)* — `new`

One `<span>`: the file's size formatted as `B` / `KB` / `MB` (the [`formatSize`](../helpers.md) helper, public). **Expected to render `null` when `file.size` is undefined** (TBD — fallback to type/extension label like today's secondary line is an open question).

**Layout:** in-flow text span inside your label column.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Convention only — the shared node contract; no part-specific props are proposed |

### `AttachmentsPanel.Item.Remove` — `changed`

One `<button>` (today a `ui` icon-ghost `Button` with a trash glyph, `aria-label="Remove <name>"`) that calls the panel's `onRemoveUpload(file.id)`. **Renders `null` when no `onRemoveUpload` is set on the panel** — safe to include unconditionally. Today it takes an `icon` override prop; **proposed: `icon` prop deleted** — childless renders the trash glyph, children replace it.

**Layout:** in-flow `shrink-0` flex child — always visible, not absolutely positioned, not hover-revealed (unlike the composer-side `AttachmentPill.Remove`, which hides until chip hover on desktop).

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | Own the node; children replace the trash glyph |

### `AttachmentsPanel.Loading` — `changed`

One `<div>`: a column of item-shaped skeleton rows (40px square + two text bars), announced with `aria-busy="true"`, `aria-live="polite"`, `aria-label="Loading files"`. Today it renders whenever mounted and the *Root default anatomy* gates it (shown only while `loading` with zero uploads); **proposed: self-gates — renders `null` unless the panel is fetching**, so it is safe to include unconditionally (as the Default example does).

**Layout:** same centered `max-w-2xl` column geometry as `.List`, so the panel doesn't shift when real rows arrive.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `count` | `number` | `3` | How many skeleton rows |
| `asChild` + native (`HTMLAttributes`, `ref`) | | | Own the node |

### `AttachmentsPanel.Empty` — `changed`

One `<div>`. Default content: a circled paperclip glyph, heading **"No files uploaded"**, hint **"Upload files to start asking questions about them"**, and — when `onAttach` is set — an "Upload files" `.Action`. Children replace all of it. Today it renders whenever mounted (Root's default anatomy gates it); **proposed: self-gates — renders `null` unless there are zero files** (as the Default/Composed examples assume).

**Layout:** fills the scroll region's height and centers its stack (`flex flex-col items-center justify-center h-full text-center`) — in-flow, not an absolute overlay.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native (`HTMLAttributes`, `ref`) | | Own the node; children replace the default icon + copy + action |

### `AttachmentsPanel.Action` — `changed`

The upload button — opens the native file picker (the hidden input wired in `.Root`), then calls your `onClick`. Default label **"Upload files"**; children replace it. Today it takes `variant: 'empty' | 'more'` (presentation only: `empty` = the pill button inside the empty state, `more` = a centered "add more" button below the list — which today wraps the button in a centering `<div>`, i.e. two nodes). **Proposed: exactly one `<button>` per the node contract — the centering wrapper becomes your layout div; whether `variant` survives at all is TBD.**

**Layout:** in-flow; where it sits (below the list, inside `.Empty`, in your header) is the parent's decision.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `'empty' \| 'more'` | `'empty'` | Presentation only (today; fate TBD under the one-node contract) |
| `onClick` | `() => void` | — | Called after opening the picker (composes, never clobbers) |
| `asChild` + native (`ButtonHTMLAttributes`, `ref`) | | | Own the node; children replace the label |

## Context (what the parts read)

`useAttachmentsPanel()` — throws outside `AttachmentsPanel.Root`. Today's shape (the panel composition context — it re-surfaces what Root was given, plus the picker trigger):

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

Proposed: field naming aligns with [`useAttachments`](../hooks/use-attachments.md) (`items`, `isLoading`, …) — exact final shape TBD.

Per-item, the `Item.*` leaves read the row context (today: the `AttachmentPill` context via `useAttachmentPill()`): `{ attachment, ext, isImage, imageSrc, isError, isBusy, label, … }` — derived view state such as "is this an image" and "which src", which is exactly what `.Preview`'s null-render is computed from.

Behaviour and data come from [`useAttachments`](../hooks/use-attachments.md) (`{ items, isLoading, upload, add, remove, clear, refresh }`, per-item error state, no global `uploadError`); it **replaces the deleted `useUploadsRegistry` alias**.

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
            file={file}
            className="flex gap-3 p-2 data-[upload-state=error]:bg-red-50"
          >
            <AttachmentsPanel.Item.Preview className="size-10 rounded" />
            <div className="min-w-0 flex-1">        {/* your layout div */}
              <AttachmentsPanel.Item.Name className="truncate" />
              <AttachmentsPanel.Item.Size className="text-muted-foreground" />
            </div>
            <AttachmentsPanel.Item.Remove aria-label="Remove file" />
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

- [`useAttachments`](../hooks/use-attachments.md) — durable-file state and actions (the L3 hook underneath; replaces the deleted `useUploadsRegistry` alias).
- [`useAttachmentsPanel`](../hooks/use-attachments-panel.md) — the compound's context reader.
- `AttachmentPill` — the composer-side chip for *pending* uploads (a separate component; see the RFC).
