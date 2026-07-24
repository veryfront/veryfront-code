# AppShell

Application shell layout — dockable sidebars, main pane, header — from `veryfront/ui`. Chat consumes it; it does not own it.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Reference only

`AppShell` lives in **`veryfront/ui`**, not `veryfront/chat` — it is already shipped and already close to the convention this RFC applies to chat (single nodes, native spread, `ref` props, compound parts). This page documents its *real, current* surface so chat compositions can be judged against it; changes to `AppShell` itself (e.g. `asChild`, the icon-slot ban on `.Trigger`) are `ui`'s call and marked TBD.

## Import

```tsx
import { AppShell } from 'veryfront/ui'
```

## Parts index

- [`AppShell` (root)](#appshell-root--kept) — `kept`
- [`.Sidebar`](#appshellsidebar--kept) — `kept`
- [`.SidebarHeader`](#appshellsidebarheader--kept) — `kept`
- [`.SidebarContent`](#appshellsidebarcontent--kept) — `kept`
- [`.SidebarFooter`](#appshellsidebarfooter--kept) — `kept`
- [`.Main`](#appshellmain--kept) — `kept`
- [`.Header`](#appshellheader--kept) — `kept`
- [`.Content`](#appshellcontent--kept) — `kept`
- [`.Trigger`](#appshelltrigger--changed) — `changed?`: `icon` slot + `data-open` under the RFC conventions — TBD, `ui`'s call

## Anatomy

```tsx
<AppShell storageKey="vf-shell">
  <AppShell.Sidebar side="left">        {/* dockable column; overlay on mobile; null when closed */}
    <AppShell.SidebarHeader border />   {/* fixed-height slot */}
    <AppShell.SidebarContent />         {/* the sidebar's scroll region */}
    <AppShell.SidebarFooter border />   {/* fixed-height slot */}
  </AppShell.Sidebar>
  <AppShell.Main>                       {/* the flexible center column */}
    <AppShell.Header border>            {/* top bar */}
      <AppShell.Trigger side="left" />  {/* sidebar toggle button */}
    </AppShell.Header>
    <AppShell.Content />                {/* fills the rest; host owns overflow */}
  </AppShell.Main>
  <AppShell.Sidebar side="right" />     {/* optional second sidebar */}
</AppShell>
```

## Default DOM (childless render)

What the composition above renders today (classes abbreviated to layout-relevant ones):

```html
<style>…design tokens…</style>                       <!-- DesignTokenStyle, emitted by the root so a standalone
                                                          shell resolves [var(--token)] utilities -->
<div data-vf-appshell class="flex h-full w-full">    <!-- Root — horizontal flex row filling its parent -->

  <!-- .Sidebar (desktop, open) — in-flow fixed-width flex column: -->
  <aside id="…-sidebar-left" aria-label="Sidebar"
         class="flex h-full shrink-0 flex-col" style="width: 240px">
    <div class="shrink-0 border-b">…</div>           <!-- .SidebarHeader — fixed height (shrink-0) -->
    <div class="min-h-0 flex-1 overflow-y-auto">…</div>  <!-- .SidebarContent — grows + scrolls (the ONLY scroller) -->
    <div class="shrink-0 border-t">…</div>           <!-- .SidebarFooter — fixed height -->
  </aside>
  <!-- .Sidebar (closed) — NOT collapsed: unmounted entirely (null) -->

  <div class="flex min-w-0 flex-1 flex-col">         <!-- .Main — takes remaining width (flex-1);
                                                          min-w-0 lets chat content truncate instead of overflowing -->
    <header class="flex shrink-0 items-center gap-1 px-3 py-2 border-b">  <!-- .Header — fixed-height toolbar row -->
      <button aria-expanded="true" aria-controls="…-sidebar-left"
              aria-label="Close left sidebar">▤</button>                  <!-- .Trigger — in-flow icon Button -->
    </header>
    <div class="min-h-0 flex-1">…</div>              <!-- .Content — fills the remaining height; deliberately NO
                                                          overflow class: the host (e.g. ChatMessageList) owns scrolling -->
  </div>
</div>

<!-- .Sidebar on MOBILE (< 640px), while open — leaves the flex flow entirely: -->
<div class="fixed inset-0 z-50 sm:hidden">           <!-- full-viewport overlay layer -->
  <div class="absolute inset-0 …overlay…"></div>     <!-- click-to-close backdrop (fades in) -->
  <aside role="dialog" aria-modal="true"
         class="absolute inset-y-0 left-0 flex h-full flex-col shadow-xl"
         style="width: 240px; transform: translateX(0)">  <!-- slides in from its edge (translateX(-100%|100%) → 0);
                                                               focus-trapped, Escape closes, body scroll locked,
                                                               focus restored on close -->
    …same Header/Content/Footer children…
  </aside>
</div>
```

**Layout summary:** one horizontal flex row; sidebars are fixed-width in-flow columns on desktop and fixed-position overlays on mobile; the center column wins all remaining space; each column is itself a vertical flex stack of `shrink-0` slots around one `flex-1 min-h-0` region.

## Parts

### `AppShell` (root) — `kept`

One `<div>` (plus the token `<style>`), providing per-side open state to all parts. **Layout: in-flow horizontal flex row, `h-full w-full` — it fills its parent; it does not create viewport height itself.**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `open` | `{ left?: boolean; right?: boolean }` | — | Controlled desktop visibility per side (omit a side to leave it uncontrolled) |
| `defaultOpen` | `{ left?; right? }` | `{ left: true, right: false }` | Uncontrolled initial desktop visibility |
| `onOpenChange` | `(side, open) => void` | — | Fires on desktop toggles with the requested next value |
| `storageKey` | `string` | — | localStorage prefix persisting uncontrolled desktop visibility (`{key}-left` / `{key}-right`) |
| `keyboardShortcut` | `boolean` | `true` | ⌘/Ctrl+B toggles the **left** sidebar |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | — | Spread onto the root div (real today) |

Mobile (< 640px) open state is separate, always starts closed, is never persisted, and resets when the viewport widens.

### `AppShell.Sidebar` — `kept`

One `<aside>`. **Layout: desktop — in-flow `shrink-0` flex column at fixed `width` (default 240px); mobile — a fixed full-viewport overlay (backdrop + edge-sliding `role="dialog"` panel, focus-trapped, Escape-to-close, scroll-locked). Renders `null` when its side is closed** — the column unmounts rather than collapsing, so content state inside does not survive a close.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `side` | `'left' \| 'right'` | `'left'` | Edge to dock to (each side has independent state + trigger) |
| `width` | `number` | `240` | Width in px (desktop column and mobile overlay panel) |
| + native + `ref` | `HTMLAttributes<HTMLElement>` | — | Spread onto the `<aside>`; `aria-label` defaults to `"Sidebar"` |

### `AppShell.SidebarHeader` — `kept`

One `<div>`. **Layout: in-flow `shrink-0` slot at the top of the sidebar column** — natural height, never scrolls. Default content: none (slot).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `border` | `boolean` | `false` | Draw the bottom divider |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | — | Spread onto the div |

### `AppShell.SidebarContent` — `kept`

One `<div>`. **Layout: the sidebar's scroll region — `flex-1 min-h-0 overflow-y-auto`, absorbing all height between header and footer.** Default content: none (slot — a chat workspace puts [`ChatSidebar`](./chat-sidebar.md) here).

| Prop | Type | Description |
| --- | --- | --- |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | Spread onto the div |

### `AppShell.SidebarFooter` — `kept`

One `<div>`. **Layout: in-flow `shrink-0` slot at the bottom of the sidebar column.** Default content: none.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `border` | `boolean` | `false` | Draw the top divider |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | — | Spread onto the div |

### `AppShell.Main` — `kept`

One `<div>`. **Layout: the flexible center — `flex-1 min-w-0` (takes all remaining row width; `min-w-0` is what lets chat content truncate instead of stretching the page), itself a vertical flex column for Header/Content.** Default content: none.

| Prop | Type | Description |
| --- | --- | --- |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | Spread onto the div |

### `AppShell.Header` — `kept`

One `<header>`. **Layout: in-flow `shrink-0` horizontal toolbar row (`flex items-center gap-1 px-3 py-2`) at the top of `.Main`.** Default content: none (put `.Trigger`, titles, actions here).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `border` | `boolean` | `false` | Draw the bottom divider |
| + native + `ref` | `HTMLAttributes<HTMLElement>` | — | Spread onto the `<header>` |

### `AppShell.Content` — `kept`

One `<div>`. **Layout: fills the remaining height of `.Main` (`flex-1 min-h-0`) and deliberately sets no overflow — the host owns scrolling** (in a chat workspace, `ChatMessageList` is the scroller). Default content: none.

| Prop | Type | Description |
| --- | --- | --- |
| + native + `ref` | `HTMLAttributes<HTMLDivElement>` | Spread onto the div |

### `AppShell.Trigger` — `changed?`

**Changed?** Whether the `icon` slot prop becomes children (icon-slot ban) and open state gains `data-open` is TBD — `ui`'s call.

One `<button>` — a `ui` `Button` (`icon-ghost` / `icon-default` by default) wired with `aria-expanded`, `aria-controls` (the target sidebar's id), and an automatic `aria-label` (`"Open/Close left sidebar"`). **Layout: an in-flow icon button — place it anywhere inside the shell (typically `.Header`); works for either side.** Default content: the `PanelLeft`/`PanelRight` glyph matching `side`. Your `onClick` composes (runs first, then the toggle).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `side` | `'left' \| 'right'` | `'left'` | Which sidebar to toggle |
| `icon` | `ReactNode` | panel glyph by `side` | Override the glyph. *Note:* an icon-slot prop — under the chat RFC's ban this would become children; whether `ui` follows is **TBD** |
| + `ButtonProps` (`variant`, `size`, native, `ref`) | | `icon-ghost` / `icon-default` | Full Button surface passes through |

**State attributes:** none today (`aria-expanded` carries open state); `data-open` would follow the chat vocabulary — **TBD**, `ui`'s call.

## Context (what the parts read)

`useAppShell()` — throws outside `<AppShell>`:

```ts
{
  isMobile: boolean                      // viewport < 640px
  isOpen: (side) => boolean              // effective visibility for the current viewport
  toggle: (side) => void
  setOpen: (side, open) => void
  sidebarId: (side) => string            // stable DOM id, for your own aria-controls
}
```

This is how you build external triggers (a button *outside* `.Header`) or react to shell state anywhere inside the provider.

## Examples

### Used with chat

```tsx
<ConversationsProvider storageKey="ops">
  <AppShell storageKey="ops-shell">
    <AppShell.Sidebar side="left">
      <AppShell.SidebarContent><ChatSidebar /></AppShell.SidebarContent>
    </AppShell.Sidebar>
    <AppShell.Main>
      <AppShell.Header border>
        <AppShell.Trigger side="left" />
      </AppShell.Header>
      <AppShell.Content>
        <Chat agentId="support-agent" api="/api/ag-ui" uploadApi="/api/uploads" />
      </AppShell.Content>
    </AppShell.Main>
  </AppShell>
</ConversationsProvider>
```

### Custom trigger via the hook

```tsx
function FilesButton() {
  const shell = useAppShell()
  return (
    <button
      aria-expanded={shell.isOpen('right')}
      aria-controls={shell.sidebarId('right')}
      onClick={() => shell.toggle('right')}
    >
      Files
    </button>
  )
}
```

## Customization (eject path)

1. **L1** — the composition above; slots take anything.
2. **L2** — every part is one node taking native attributes and `ref`; add/replace slots freely (the parts are conveniences over plain flex).
3. **L3** — `useAppShell()` for state, your own markup for layout — the shell's real API is `{ isOpen, toggle, sidebarId, isMobile }` plus persistence; nothing stops you rendering your own columns against it.

## Related

- [`useAppShell`](../hooks/use-app-shell.md) — shell state hook.
- [`ChatSidebar`](./chat-sidebar.md) — the usual left-sidebar occupant.
- [`useColorMode` / `ColorModeProvider` / `ColorModeToggle`](../hooks/use-color-mode.md) — color mode, also from `veryfront/ui`, documented as-is.
