# AgentPicker

A searchable popover for choosing an agent — pill trigger, filterable list, optional create/manage actions — render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AgentPicker } from 'veryfront/chat'
```

## Anatomy

```tsx
<AgentPicker.Root agents={options} value={agentId} onValueChange={setAgentId}>
  <AgentPicker.Trigger />                  {/* pill: Avatar · selected name · chevron */}
  <AgentPicker.Content>                    {/* portalled popover panel + search context */}
    <AgentPicker.Search />                 {/* filter input (preset shows it only past 5 agents) */}
    <AgentPicker.List>                     {/* scrollable option region */}
      <AgentPicker.Item agent={option} />  {/* Avatar · name · check when selected */}
    </AgentPicker.List>
    <AgentPicker.Create />                 {/* null unless onCreate on Root */}
    <AgentPicker.Manage />                 {/* null unless onManage on Root */}
  </AgentPicker.Content>
</AgentPicker.Root>
```

`<AgentPicker.Root>` with **no children renders the default data-driven preset** (render-or-compose, like `ToolCall`): trigger + panel with search (gated on agent count), the grouped option list, and the `Create`/`Manage` rows when their callbacks exist. Pass children to recompose.

## Default DOM (childless render)

What the preset actually renders today (classes abbreviated to layout-relevant ones):

```html
<span class="relative inline-block">                                <!-- .Root — popper ANCHOR WRAPPER (see open question) -->
  <button aria-haspopup="dialog" aria-expanded
          class="inline-flex h-9 items-center gap-1.5 rounded-full px-3">  <!-- .Trigger — ui Pill; in-flow inline-flex row -->
    <div class="size-5 shrink-0 rounded-full overflow-hidden">…</div>      <!-- Avatar (image or initial); shrink-0 -->
    <span class="min-w-0 truncate">Support Agent</span>                    <!-- selected name; truncates -->
    <svg class="ml-auto size-3.5 shrink-0">…</svg>                         <!-- chevron pushed right via ml-auto -->
  </button>

  <!-- .Content — only while open. NOT in flow: portalled to document.body by the
       Floating helper, position: fixed, placed 8px below the trigger rect (flips
       above when it would overflow the viewport bottom; clamped to 8px gutters). -->
  <div role="dialog" class="z-50 min-w-[280px] rounded-lg overflow-hidden shadow-sm">
    <div class="overflow-hidden rounded-lg">                        <!-- Command shell (filter context) -->
      <div class="relative flex items-center px-2.5 border-b">      <!-- .Search row; icon + clear are absolute WITHIN this row -->
        <span class="absolute left-4 pointer-events-none">🔍</span>
        <input class="h-12 w-full pl-9 pr-9" placeholder="Search agents..." />  <!-- fills row width -->
        <button class="absolute right-2 size-6 rounded-full">✕</button>         <!-- clear; present only while query non-empty -->
      </div>
      <div class="max-h-[320px] overflow-y-auto p-2.5">             <!-- .List — the scroll container (hidden scrollbar) -->
        <div class="text-center py-8 px-4">No agents found.</div>   <!-- CommandEmpty; present only when the filter matches nothing -->
        <div class="p-0.5">                                         <!-- CommandGroup (top `agents` group) -->
          <div role="option" class="flex items-center gap-3 min-w-0 rounded-md px-3 py-2">  <!-- .Item -->
            <div class="size-5 shrink-0 rounded-full">…</div>       <!-- Avatar -->
            <span class="min-w-0 flex-1 truncate">Support Agent</span>  <!-- name grows + truncates -->
            <svg class="ml-auto">✓</svg>                            <!-- check; selected item only -->
          </div>
          <!-- …one row per agent; filtered-out rows get the `hidden` attribute -->
        </div>
        <div class="p-0.5">…</div>                                  <!-- one CommandGroup per `sections` entry (optional heading div) -->
        <div class="p-0.5">                                         <!-- action group; present only when onCreate/onManage passed -->
          <div role="option">＋ Create Agent</div>                  <!-- .Create -->
          <div role="option">✦ Manage Agents</div>                  <!-- .Manage -->
        </div>
      </div>
    </div>
  </div>
</span>
```

Notes for the reviewer:

- The `.Search` row appears in the preset only when the combined agent count exceeds **5** (`SEARCH_THRESHOLD`).
- While `isLoading` and no section has agents, the list swaps `CommandEmpty` for a 3-row skeleton (`<output aria-label="Loading agents">` with pulsing avatar/name bars). The RFC replaces the `isLoading` prop with `data-loading` on `.List` (global vocabulary).
- Today `.Item` is a `role="option"` **`<div>`** and `.Content` interposes the Command shell `<div>`; the proposed shape is `.Item` → one `<button>` and `.Content` → one `<div>` (search/list context carried by React context, no extra shell node).

## Parts

### `AgentPicker.Root`

The compound's scoped context (selection, open state, options) + the popover root. **Layout: renders no in-flow layout of its own — but today it emits a `<span class="relative inline-block">` positioning anchor** (the popper-anchor open question, below); the proposed contract is zero nodes.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `agents` *(required)* | `AgentOption[]` | — | Options for the default (top) group. `AgentOption = { id, name, avatarUrl?, disabled? }` (`avatarSrc` is deprecated) |
| `value` | `string` | — | Selected agent id (controlled) |
| `onValueChange` | `(id: string) => void` | — | Called with the chosen agent id (selection also closes the popover) |
| `sections` | `AgentPickerSection[]` | `[]` | Extra labelled groups below the default group: `{ label?, agents }` |
| `onCreate` / `onManage` | `() => void` | — | Enable the `.Create` / `.Manage` rows (they null-render otherwise) |
| `onOpenChange` | `(open: boolean) => void` | — | Notified whenever the popover opens or closes |
| `children` | `ReactNode` | — | Omit for the default preset; pass to recompose |
| + native *(proposed)* | `HTMLAttributes` · `asChild` · `ref` | — | Per the node contract — pending the popper-anchor decision |

**Removed (proposed):** `inputStyle` (style `.Trigger` directly — `className`/`asChild`), `invalid` (→ `data-invalid` on `.Search`), `isLoading` (→ `data-loading` on `.List`), and Root-level `className` (today it silently styles the *trigger* — an alias the node contract bans; class the `.Trigger` itself).

**Popper anchor (open question):** today `Popover` renders a wrapper `<span class="relative inline-block">` as the positioning anchor — same as `veryfront/ui`'s `DropdownMenu`. Either `ui` fixes this (Floating UI can anchor to the trigger ref) or a narrow "positioning anchor" exception to the node contract is sanctioned for popper roots. `AgentPicker.Root` depends on that decision (goes to the team on the RFC PR).

### `AgentPicker.Trigger`

One `<button>` (today a `ui` Pill merged onto `PopoverTrigger` via `asChild`; `aria-haspopup` + `aria-expanded` wired). **Layout: in-flow `inline-flex h-9` row, `gap-1.5`; the name truncates (`min-w-0 truncate`); the chevron is pushed right with `ml-auto`.** Default content: selected agent's `Avatar` (when one is selected) → name (or `"Select agent"`) → chevron. Children replace the default content.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the Avatar/name/chevron default |
| `asChild` + native + `ref` *(proposed)* | | Own the node; today only `className` |

**State attributes (proposed):** `data-open` — today open state is visible only via `aria-expanded`. **Removed (proposed):** `inputStyle`, `invalid` (today the input-style variant renders `data-invalid` on this button; the proposal keeps `data-invalid` on `.Search` and deletes the input-style variant — an input-look trigger is your `className`/`asChild`), `icon` (icon-slot ban — childless renders the chevron, children replace everything).

### `AgentPicker.Content`

The popover panel — one `<div role="dialog">`. **Layout: not in flow — portalled to `document.body`, `position: fixed`, placed by the floating logic 8px below the trigger rect (flips above on viewport-bottom collision, clamped to 8px gutters), `z-50`, `min-w-[280px]`.** Today it also interposes the Command shell `<div>` that owns the filter context; proposed: one node, context via React. **Renders `null` while closed** (the surface unmounts).

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | `.Search` / `.List` / your own nodes |
| `asChild` + native + `ref` *(proposed)* | | Own the panel node; today only `className` (merged onto the popover surface) |

Alignment today is fixed `align="start"`; whether `align`/`side` become public props is **TBD**.

### `AgentPicker.Search`

The filter input — one `<input>` (today a `CommandInput` row: the row `<div>` is `relative flex items-center`, the search icon and the clear button are `absolute` *within the row*, the input fills it at `h-12 w-full`; the clear button exists only while the query is non-empty). Bound to the compound's filter query — filtering is case-insensitive substring on item names. Safe to include always; the *preset* gates it on agent count > 5.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `placeholder` | `string` | `"Search agents..."` | |
| `asChild` + native + `ref` *(proposed)* | | | Own the input node; today only `className` (on the `<input>`) |

**Layout: in-flow row at the top of the panel (border-b divider).** **State attributes:** `data-invalid` — kept from today (validation failed). Whether the icon/clear affordances survive the one-node contract (children? separate leaves?) is **TBD**.

### `AgentPicker.List`

The option region — one scroll container (today a `<div class="max-h-[320px] overflow-y-auto p-2.5">` with hidden scrollbar; proposed node `<ul>`). Default content (preset): "No agents found." empty row → the top `agents` group → skeleton loading rows (only while loading with no section data) → one labelled group per `sections` entry → the action group. Composed: children replace all of that.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Your `.Item`s / groups |
| `asChild` + native + `ref` *(proposed)* | | Own the scroll node; today only `className` |

**Layout: in-flow block below `.Search`; the panel's only scrolling region (`max-h-[320px]`).** **State attributes (proposed):** `data-empty` (zero options), `data-loading` (replaces the `isLoading` prop; today loading renders skeleton rows).

### `AgentPicker.Item`

One selectable agent row — today a `role="option"` `<div>` (proposed: `<button>`). **Layout: in-flow `flex items-center gap-3 min-w-0` row; the name is `flex-1 truncate`; the check is `ml-auto`.** Default content: `Avatar` (image or initial) → name → check glyph (selected only). Filtered-out rows are `hidden` (today via the filter registry); `disabled` options dim and block pointer events (`aria-disabled`). Selecting calls `onValueChange` and closes the popover.

| Prop | Type | Description |
| --- | --- | --- |
| `agent` *(required)* | `AgentOption` | The row's option; its `id` is the selection value, its `name` the search keyword |
| `asChild` + native + `ref` *(proposed)* | | Own the row node; today only `className` |

**State attributes (proposed):** `data-active` — replaces today's `selected?: boolean` prop (preset passes it; composed items already default to matching the context `value`). **Removed (proposed):** `selected`, `icon` (check-glyph slot → icon-slot ban).

### `AgentPicker.Create`

The "Create Agent" action row (today a `CommandItem`, proposed `<button>`). Default content: plus glyph → `"Create Agent"`. **Renders `null` unless `onCreate` was passed to `.Root`** — safe to include unconditionally. Selecting closes the popover, then calls `onCreate`. **Layout: in-flow row inside `.List`/`.Content`, same row mechanics as `.Item`.**

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Replace the default label (childless renders glyph + "Create Agent") |
| `asChild` + native + `ref` *(proposed)* | | Own the node; today only `className`. `icon` removed (icon-slot ban) |

### `AgentPicker.Manage`

Identical contract to `.Create`: default content sparkles glyph → `"Manage Agents"`; **renders `null` unless `onManage` was passed to `.Root`**; closes then calls `onManage`. Same props/layout as `.Create`.

## Context (what the parts read)

`useAgentPicker()` — throws outside `AgentPicker.Root`:

```ts
{
  value?: string              // selected agent id
  onSelect: (id) => void      // select + close + onValueChange
  open: boolean
  setOpen: (open) => void     // also fires onOpenChange
  onCreate?: () => void       // present only when Root received it
  onManage?: () => void
}
```

**Proposed additions:** `{ query, setQuery, options, select }` — the search query and the resolved (filtered, sectioned) option list move into the reader, so a headless list needs no internal Command machinery. Today the query lives in the private Command context and is unreachable from `useAgentPicker()`.

## State attributes

| Attribute | On | Meaning | Status |
| --- | --- | --- | --- |
| `data-open` | `.Trigger` | Picker is expanded | proposed |
| `data-active` | `.Item` | Current selection | proposed (replaces `selected`) |
| `data-invalid` | `.Search` | Validation failed | kept from today |
| `data-empty` | `.List` | Zero options | proposed |
| `data-loading` | `.List` | Agents fetch in flight | proposed (replaces `isLoading`) |

## Examples

### Default

```tsx
<AgentPicker agents={options} value={agentId} onValueChange={setAgentId}
  onCreate={openCreateFlow} onManage={openAgentsPage} />
```

### Composed

```tsx
<AgentPicker.Root agents={options} value={agentId} onValueChange={setAgentId}>
  <AgentPicker.Trigger className="my-trigger">Choose agent</AgentPicker.Trigger>
  <AgentPicker.Content className="my-panel">
    <AgentPicker.Search placeholder="Search agents…" />
    <AgentPicker.List>
      {options.map((option) => (
        <AgentPicker.Item key={option.id} agent={option} />
      ))}
    </AgentPicker.List>
    <div className="my-footer">{/* YOUR div */}
      <AgentPicker.Create>New agent</AgentPicker.Create>
      <AgentPicker.Manage>Manage</AgentPicker.Manage>
    </div>
  </AgentPicker.Content>
</AgentPicker.Root>
```

### Headless

```tsx
function MyAgentList() {
  const picker = useAgentPicker()
  return (
    <>
      <input value={picker.query} onChange={(e) => picker.setQuery(e.target.value)} />
      <ul className="anything">
        {picker.options.map((option) => (
          <li key={option.id}>
            <button onClick={() => picker.select(option)}>{option.name}</button>
          </li>
        ))}
      </ul>
    </>
  )
}
```

## Customization (eject path)

1. **L1** — the [`ChatAgentPicker`](./chat-agent-picker.md) preset (data wired via `useAgents`), or the childless `<AgentPicker agents={…} />` preset.
2. **L2** — paste the preset's composition (printed under *Anatomy*) and edit the piece you care about; every part is one node (`asChild`, your classes), every layout div between them is yours.
3. **L3** — [`useAgentPicker()`](../hooks/use-agent-picker.md) inside the Root, with [`agentsToPickerOptions`](./chat-agent-picker.md) mapping agents to options.

## Related

- [`ChatAgentPicker`](./chat-agent-picker.md) — the preset over this compound
- [`ModelSelector`](./model-selector.md) — same anatomy minus `.Create` / `.Manage`
- [`useAgentPicker`](../hooks/use-agent-picker.md) · [`useAgents`](../hooks/use-agents.md)
