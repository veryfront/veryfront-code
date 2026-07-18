# ChatActions

The composer's actions menu — a dropdown of data-driven rows (attach, custom actions, settings), with thread-level export/clear composed from public helpers.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatActions } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatActions.Root actions={actions} onAttachFiles={openPicker} settings={settings}>
  <ChatActions.Trigger />          {/* `+` icon button */}
  <ChatActions.Content>            {/* portalled menu surface */}
    <ChatActions.Item />           {/* one action row */}
    <ChatActions.Preset />         {/* the whole data-driven default body (no node) */}
  </ChatActions.Content>
</ChatActions.Root>
```

`<ChatActions.Root>` with **no children renders the default preset** (render-or-compose): `Trigger` + `Content` containing `Preset`. **`.Preset` is the escape hatch between the two modes** — it renders the *entire* data-driven default body (attach row + `actions` rows + settings submenu) from context, as a fragment with no node of its own, so a composed `Content` can drop the default rows back in alongside custom ones.

## Default DOM (childless render)

What the preset actually renders today (classes abbreviated to layout-relevant ones):

```html
<span class="relative inline-block">                          <!-- .Root — DropdownMenu ANCHOR WRAPPER (popper open question) -->
  <button aria-haspopup="menu" aria-expanded
          aria-label="Add attachments and settings"
          class="shrink-0 …icon-button…">                     <!-- .Trigger — `+` ui Button (icon-tertiary / icon-lg); in flow -->
    <svg>＋</svg>
  </button>

  <!-- .Content — only while open. NOT in flow: portalled to document.body by
       Floating, position: fixed, 8px below the trigger rect (flips above on
       viewport-bottom collision; clamped to 8px gutters), align="start". -->
  <div role="menu" class="z-50 min-w-[260px] rounded-lg p-2.5 shadow-sm overflow-hidden">
    <!-- .Preset — NO node; emits the following siblings directly: -->
    <button role="menuitem" class="flex w-full items-center gap-2.5 rounded-md px-3 h-[36px]">
      <svg>📎</svg> Attach Files or Photos                    <!-- built-in attach .Item; only when onAttachFiles -->
    </button>
    <button role="menuitem" class="flex w-full items-center gap-2.5 …">
      … one .Item per `actions` entry (icon · label) …
    </button>
    <div class="-mx-2.5 my-2 h-px"></div>                     <!-- separator; only when settings AND rows above it -->
    <div class="relative">                                    <!-- Settings submenu row (preset-internal, NOT a public part) -->
      <button role="menuitem" aria-haspopup="menu" aria-expanded
              class="flex w-full items-center gap-2.5 px-3 h-[36px]">
        ⚙ Settings <svg class="ml-auto">›</svg>               <!-- chevron pushed right via ml-auto -->
      </button>
      <!-- submenu while open: a SECOND portalled Floating (fixed, align="end",
           min-w-[240px]) — hover-opened with a 160ms close-grace + an invisible
           absolute "hover bridge" strip spanning the gap; contains two
           label+Switch toggle rows (Auto-send queue, Autofix errors) -->
    </div>
  </div>
</span>
```

Notes for the reviewer:

- **`.Preset` renders no element.** It is a context-driven fragment: attach row (when `onAttachFiles`) → `actions` rows in order → separator + settings submenu (when `settings`, separator only when rows precede it). With an empty context it renders nothing at all.
- The **Settings submenu is a preset internal**, not a decomposable sub-part — its portalled `Floating`, hover-grace timing, and `stopPropagation` on pointer-down (so toggling a Switch in the portalled/"outside" submenu doesn't dismiss the parent menu) are not part of the public anatomy. Keep-vs-generalize (a public `.Sub`?) is **TBD**.
- Rows are real `<button role="menuitem">` elements already (via `DropdownMenuItem`).

## Parts

### `ChatActions.Root`

The scoped context provider + dropdown root. **Layout: no in-flow layout of its own — but today it emits the `ui` `DropdownMenu` anchor wrapper `<span class="relative inline-block">`** (same popper-anchor open question as `AgentPicker.Root`/`ModelSelector.Root`; noted for the RFC PR).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `actions` | `ChatActionItem[]` | `[]` | Data-driven rows for the preset: `{ id?, icon?, label, title?, disabled?, onSelect }` — ignored when you pass children (read them back via `.Preset` / `useChatActions()`) |
| `onAttachFiles` | `() => void` | — | Enables the built-in attach row (hidden when omitted) |
| `attachFilesLabel` | `string` | `"Attach Files or Photos"` | Label for the built-in attach row |
| `settings` | `ChatActionsSettings` | — | Enables the Settings submenu: `{ autoSubmit, autoFixErrors, onAutoSubmitChange, onAutoFixErrorsChange }` (hidden when omitted) |
| `open` / `defaultOpen` / `onOpenChange` | `boolean` / `boolean` / `(open) => void` | — | Controlled / uncontrolled menu state |
| `children` | `ReactNode` | — | Omit for the preset; pass to recompose |
| + native *(proposed)* | `HTMLAttributes` · `asChild` · `ref` | — | Pending the popper-anchor decision |

**Removed (proposed):** `trigger?: ReactNode` — compose `.Trigger` children instead (composition, not render-prop config); Root-level `className` (today it styles the *menu surface* — class `.Content` directly).

### `ChatActions.Trigger`

One `<button>` — the default is a `+` icon `ui` Button (`icon-tertiary` / `icon-lg`, `aria-label="Add attachments and settings"`), merged onto the dropdown trigger via `asChild` with `aria-haspopup`/`aria-expanded` wired. **Layout: in-flow `shrink-0` icon button (designed for a composer toolbar row).** Children replace the whole default button — a custom child must forward props to a single focusable element.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the default `+` button (this is where the deleted `trigger` prop went) |
| `asChild` + native + `ref` *(proposed)* | | Own the node; today only `className` (merged onto the default button) |

**State attributes (proposed):** `data-open` — today only `aria-expanded`.

### `ChatActions.Content`

The menu surface — one `<div role="menu">`. **Layout: not in flow — portalled to `document.body`, `position: fixed`, placed by the floating logic below the trigger (collision-flipped, gutter-clamped), `z-50`, `min-w-[260px]`, `p-2.5`.** **Renders `null` while closed** (unmounts). Default content: none — children are the rows (`.Item`s, `.Preset`, your own nodes).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `align` | `'start' \| 'end'` | `'start'` | Horizontal alignment relative to the trigger |
| `children` | `ReactNode` | — | The rows |
| `asChild` + native + `ref` *(proposed)* | | | Own the surface node; today only `className` |

### `ChatActions.Item`

One action row — one `<button role="menuitem">`. **Layout: in-flow full-width flex row (`flex w-full items-center gap-2.5 px-3 h-[36px]`); trailing content can push right with `ml-auto`.** Default content: none — children are the label (icon first, per the icon-slot ban: childless renders nothing special; put the glyph in children). Selecting runs `onSelect` and closes the menu.

| Prop | Type | Description |
| --- | --- | --- |
| `onSelect` | `() => void` | Called when chosen (menu also closes) |
| `title` | `string` | Native tooltip |
| `disabled` | `boolean` | Dims + blocks selection. *Proposed:* also reflected as `data-disabled` |
| `children` | `ReactNode` | Row content (glyph + label) |
| `asChild` + native + `ref` *(proposed)* | | Own the row node; today only `className`. `icon` prop removed (icon-slot ban) |

### `ChatActions.Preset`

The default data-driven menu body, **rendered as a fragment — no node, no props** (today it takes none). Reads `useChatActions()` and emits, in order: the attach `.Item` (only when `onAttachFiles` exists) → one `.Item` per `actions` entry → a separator + the Settings submenu (only when `settings` exists; separator only when rows precede it). **Renders nothing when the context carries no attach/actions/settings.** Its purpose: a composed `Content` can keep the entire default body and add rows around it —

```tsx
<ChatActions.Content>
  <ChatActions.Item onSelect={exportThread}>Export…</ChatActions.Item>
  <ChatActions.Preset />   {/* default rows, below your custom one */}
</ChatActions.Content>
```

**Layout: none of its own — its emitted rows are in-flow children of `.Content`** (the Settings submenu inside it opens a second fixed-position portal, hover-managed; see *Default DOM*).

## Context (what the parts read)

`useChatActions()` — throws outside `ChatActions.Root` (a misplaced sub-part is a loud error, never a silent null):

```ts
{
  actions: ChatActionItem[]        // the data-driven rows ([] when composed without them)
  onAttachFiles?: () => void
  attachFilesLabel: string         // resolved (default applied)
  settings?: ChatActionsSettings
}
```

Note this reader carries **menu data only** — not open state (that lives in the dropdown primitive today; whether `open`/`setOpen` join the reader is **TBD**).

### Export and clear are compositions, not built-ins

Thread-level export and clear are **composed from public helpers**, not baked into the compound or its hook:

- **Export** — `exportAsMarkdown(messages)` / `downloadMarkdown(messages, filename?)`
- **Clear** — `setMessages([])` from the chat session

## State attributes

| Attribute | On | Meaning | Status |
| --- | --- | --- | --- |
| `data-open` | `.Trigger` | Menu is expanded | proposed |
| `data-disabled` | `.Item` | Row disabled | proposed (today `disabled` prop + `aria-disabled` styling) |

## Examples

### Default

```tsx
<ChatActions
  onAttachFiles={() => fileInputRef.current?.click()}
  actions={[{ label: 'Insert template', onSelect: insertTemplate }]}
  settings={{ autoSubmit, autoFixErrors, onAutoSubmitChange, onAutoFixErrorsChange }}
/>
```

### Composed

```tsx
function ThreadActions() {
  const { messages, setMessages } = useChatContext()
  return (
    <ChatActions.Root>
      <ChatActions.Trigger aria-label="Thread actions">
        <MoreIcon /> {/* children replace the default `+` button */}
      </ChatActions.Trigger>
      <ChatActions.Content className="my-menu">
        <ChatActions.Item onSelect={() => downloadMarkdown(messages)}>
          Export as Markdown
        </ChatActions.Item>
        <ChatActions.Item onSelect={() => setMessages([])}>
          Clear conversation
        </ChatActions.Item>
      </ChatActions.Content>
    </ChatActions.Root>
  )
}
```

### Headless

The actions themselves are public helpers, so a fully custom menu needs no compound at all:

```tsx
function MyActionsMenu() {
  const { messages, setMessages } = useChatContext()
  return (
    <MyMenu>
      <MyMenu.Item onSelect={() => downloadMarkdown(messages)}>Export</MyMenu.Item>
      <MyMenu.Item onSelect={() => setMessages([])}>Clear</MyMenu.Item>
    </MyMenu>
  )
}
```

## Customization (eject path)

1. **L1** — default actions inside `<Chat />`.
2. **L2** — pass children: keep `.Preset` for the default rows and add `.Item`s around it, or drop `.Preset` and own every row; the trigger's children are yours.
3. **L3** — skip the compound: any menu built from `exportAsMarkdown` / `downloadMarkdown` + `setMessages`; [`useChatActions()`](../hooks/use-chat-actions.md) reads the row data if you're composing inside the Root.

## Related

- [`useChatActions`](../hooks/use-chat-actions.md)
- `exportAsMarkdown` / `downloadMarkdown` — transcript export helpers
- `useChat` — `setMessages` for clear
- `ChatInput.Export` — the composer's one-click export button
- [`AgentPicker`](./agent-picker.md) — shares the popper-anchor open question
