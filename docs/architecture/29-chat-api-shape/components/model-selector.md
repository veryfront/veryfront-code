# ModelSelector

A searchable popover for choosing a model — provider-logo trigger, provider-grouped list — with `models` configured on the leaf that uses it.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ModelSelector } from 'veryfront/chat'
```

## Anatomy

The same anatomy as [`AgentPicker`](./agent-picker.md), minus `.Create` and `.Manage`:

```tsx
<ModelSelector.Root value={model} onChange={setModel}>
  <ModelSelector.Trigger models={MODELS} />  {/* pill: provider logo · label · chevron (or icon-only) */}
  <ModelSelector.Content>                    {/* portalled popover panel + search context */}
    <ModelSelector.Search />                 {/* filter input (preset shows it only past 6 models) */}
    <ModelSelector.List>                     {/* scrollable, provider-grouped option region */}
      <ModelSelector.Item model={option} />  {/* logo · label · badge · check when selected */}
    </ModelSelector.List>
  </ModelSelector.Content>
</ModelSelector.Root>
```

`<ModelSelector.Root>` with **no children renders the default data-driven preset** (render-or-compose): trigger + panel with count-gated search and the provider-grouped list. Pass children to recompose.

## Default DOM (childless render)

What the preset actually renders today (classes abbreviated to layout-relevant ones):

```html
<span class="relative inline-block">                                <!-- .Root — popper ANCHOR WRAPPER (see open question) -->
  <button aria-haspopup="dialog" aria-expanded
          class="inline-flex h-9 items-center gap-1.5 rounded-full px-3">  <!-- .Trigger — ui Pill (variant="pill"); in-flow row -->
    <img class="size-4 shrink-0 object-contain" src="https://models.dev/logos/openai.svg" />  <!-- provider logo (glyph fallback on 404) -->
    <span class="min-w-0 truncate">GPT-4o</span>                    <!-- selected label; truncates -->
    <svg class="ml-auto size-3.5 shrink-0">…</svg>                  <!-- chevron pushed right via ml-auto -->
  </button>
  <!-- variant="icon" instead renders: round size-9 button, logo centered, no label/chevron -->

  <!-- .Content — only while open. NOT in flow: portalled to document.body,
       position: fixed, placed 8px below the trigger rect by the floating logic
       (flips above on viewport-bottom collision; clamped to 8px gutters). -->
  <div role="dialog" class="z-50 min-w-[260px] rounded-lg overflow-hidden shadow-sm">
    <div class="overflow-hidden rounded-lg">                        <!-- Command shell (filter context) -->
      <div class="relative flex items-center px-2.5 border-b">      <!-- .Search row; icon + clear are absolute WITHIN this row -->
        <span class="absolute left-4 pointer-events-none">🔍</span>
        <input class="h-12 w-full pl-9 pr-9" placeholder="Search models..." />
        <button class="absolute right-2 size-6 rounded-full">✕</button>  <!-- clear; only while query non-empty -->
      </div>
      <div class="max-h-[320px] overflow-y-auto p-2.5">             <!-- .List — the scroll container (hidden scrollbar) -->
        <div class="text-center py-8 px-4">No models found.</div>   <!-- CommandEmpty; only when filter matches nothing -->
        <div class="p-0.5">                                        <!-- CommandGroup per provider (heading div = provider name);
                                                                        one ungrouped block when no model has `provider` -->
          <div class="pb-1.5 text-sm font-medium">openai</div>
          <div role="option" class="flex items-center gap-3 min-w-0 rounded-md px-3 py-2">  <!-- .Item -->
            <img class="size-4.5 shrink-0 object-contain" />        <!-- provider logo -->
            <span class="min-w-0 flex-1 truncate">GPT-4o</span>     <!-- label grows + truncates -->
            <span class="rounded-full border px-1.5 text-[10px]">New</span>  <!-- badge; only when option has `badge` -->
            <svg class="ml-auto">✓</svg>                            <!-- check; selected item only -->
          </div>
        </div>
      </div>
    </div>
  </div>
</span>
```

Notes for the reviewer:

- The `.Search` row appears in the preset only when the model count exceeds **6** (`SEARCH_THRESHOLD`).
- Grouping: when *any* model has `provider`, the list renders one labelled `CommandGroup` per provider (insertion order); otherwise a single unlabelled group.
- `ModelOption.description` is declared on the type but **not rendered** by today's default `.Item` — whether the proposed default row shows it is TBD.
- Today `.Item` is a `role="option"` `<div>`; proposed `<button>`. Today `.Content` interposes the Command shell `<div>`; proposed one node.

## Parts

### `ModelSelector.Root`

The compound's scoped context (selection, open state, disabled) + the popover root. **Layout: no in-flow layout of its own — but today it emits the `<span class="relative inline-block">` positioning anchor.** Same **popper-anchor open question** as `AgentPicker.Root`: either `ui` anchors to the trigger ref, or a narrow positioning-anchor exception is sanctioned; this Root depends on that decision.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Selected `"provider/model"` value; `undefined` = agent default (resolves to the first model for display) |
| `onChange` *(required)* | `(model: string) => void` | — | Called with the chosen value (selection also closes the popover) |
| `disabled` | `boolean` | — | Blocks opening; dims the trigger |
| `models` | `ModelOption[]` | — | *Liftable* config — see below. `ModelOption = { value, label, provider?, description?, badge? }` |
| `children` | `ReactNode` | — | Omit for the default preset; pass to recompose |
| + native *(proposed)* | `HTMLAttributes` · `asChild` · `ref` | — | Per the node contract — pending the popper-anchor decision |

**Removed (proposed):** `renderItem` (render-prop ban — compose `.Item` children or map options yourself), Root-level `className` (today it styles the *trigger*; class the `.Trigger` itself).

**`models` — config on the leaf, liftable (escalation rule):** the default home for `models` is the leaf that uses it — `<ModelSelector.Trigger models={MODELS} />` / `<ChatInput.Model models={MODELS} />`. When more than one leaf needs the same list it may be *lifted* to opt-in Root context (`<ModelSelector.Root models={MODELS}>`); **the leaf prop always wins** (explicit prop > nearest context > default). Today `models` is required on the root — the leaf-first placement is the proposed change.

### `ModelSelector.Trigger`

One `<button>` (today a `ui` Pill or a round icon button merged onto `PopoverTrigger` via `asChild`; `aria-haspopup`/`aria-expanded` wired). Two default appearances via `variant`:

- `"pill"` *(default)* — **in-flow `inline-flex h-9` row, `gap-1.5`**: provider logo (`shrink-0`, models.dev SVG with glyph fallback) → selected label (or `"Select model"`, `min-w-0 truncate`) → chevron (`ml-auto`).
- `"icon"` — **round `size-9` flex-centered button**, logo only, accessible name from the selected label (`aria-label`).

Children replace the default content (today children render inside a plain `<button>`).

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `variant` | `'pill' \| 'icon'` | `'pill'` | Default-content style |
| `models` *(proposed)* | `ModelOption[]` | — | Leaf-first config placement (see Root) |
| `children` | `ReactNode` | — | Replace the logo/label/chevron default |
| `asChild` + native + `ref` *(proposed)* | | | Own the node; today only `className` |

**State attributes (proposed):** `data-open` (today only `aria-expanded`), `data-disabled`.

### `ModelSelector.Content`

The popover panel — one `<div role="dialog">`. **Layout: not in flow — portalled to `document.body`, `position: fixed`, placed by the floating logic below the trigger (collision-flipped, gutter-clamped), `z-50`, `min-w-[260px]`.** Today it also interposes the Command shell `<div>` (filter context); proposed: one node, context via React. **Renders `null` while closed.** Alignment today is fixed `align="start"`; public `align`/`side` props are **TBD**.

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | `.Search` / `.List` / your own nodes |
| `asChild` + native + `ref` *(proposed)* | | Own the panel node; today only `className` |

### `ModelSelector.Search`

The filter input — one `<input>` (today a `CommandInput` row; same internal mechanics as `AgentPicker.Search`: `relative` row, absolute icon left / conditional clear button right, `h-12 w-full` input). Case-insensitive substring filter over item labels. **Layout: in-flow row at the top of the panel (border-b divider).**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `placeholder` | `string` | `"Search models..."` | |
| `asChild` + native + `ref` *(proposed)* | | | Own the input node; today only `className` |

### `ModelSelector.List`

The option region — one scroll container (today `<div class="max-h-[320px] overflow-y-auto">`; proposed node `<ul>`). Default content (preset): "No models found." empty row, then provider-grouped `.Item` rows. Composed: children replace it. **Layout: in-flow block below `.Search`; the panel's only scrolling region.**

| Prop | Type | Description |
| --- | --- | --- |
| `children` | `ReactNode` | Your `.Item`s / groups |
| `asChild` + native + `ref` *(proposed)* | | Own the scroll node; today only `className` |

**State attributes (proposed):** `data-empty` (zero options).

### `ModelSelector.Item`

One selectable model row — today a `role="option"` `<div>` (proposed: `<button>`). **Layout: in-flow `flex items-center gap-3 min-w-0` row; the label is `flex-1 truncate`; badge sits between label and check; check is `ml-auto`.** Default content: provider logo → label → badge pill (only when the option has `badge`) → check glyph (selected only). Filtered-out rows are `hidden`. Selecting calls `onChange` and closes the popover.

| Prop | Type | Description |
| --- | --- | --- |
| `model` *(required)* | `ModelOption` | The row's option; its `value` is the selection value, its `label` the search keyword |
| `asChild` + native + `ref` *(proposed)* | | Own the row node; today only `className` |

**State attributes (proposed):** `data-active` — replaces today's `selected?: boolean` prop (composed items already default to matching the context selection).

## Context (what the parts read)

`useModelSelector()` — throws outside `ModelSelector.Root`:

```ts
{
  value?: string                 // selected "provider/model"
  selectedModel?: ModelOption    // resolved option (value match, else first model)
  onSelect: (value) => void      // select + close + onChange
  open: boolean
  setOpen: (open) => void
  disabled?: boolean
}
```

(`selected` is a deprecated alias of `selectedModel` today; dropped in the proposal.) **Proposed additions (mirroring `AgentPicker`):** `query` / `setQuery` and the resolved option list, so a headless menu needs no Command internals — exact shape **TBD** with the `useAgentPicker` reader.

## State attributes

| Attribute | On | Meaning | Status |
| --- | --- | --- | --- |
| `data-open` | `.Trigger` | Selector is expanded | proposed |
| `data-active` | `.Item` | Current selection | proposed (replaces `selected`) |
| `data-empty` | `.List` | Zero options | proposed |
| `data-disabled` | `.Trigger` | Selector disabled | proposed (today a `disabled` prop + opacity classes) |

## Examples

### Default

Inside the composer, the model trigger is `ChatInput.Model` with `models` on the leaf:

```tsx
<ChatInput.Model models={MODELS} />
```

Standalone preset:

```tsx
<ModelSelector models={MODELS} value={model} onChange={setModel} />
```

### Composed

```tsx
<ModelSelector.Root value={model} onChange={setModel}>
  <ModelSelector.Trigger models={MODELS} variant="icon" className="my-trigger" />
  <ModelSelector.Content className="my-panel">
    <ModelSelector.Search placeholder="Search models…" />
    <ModelSelector.List>
      {MODELS.map((m) => <ModelSelector.Item key={m.value} model={m} />)}
    </ModelSelector.List>
  </ModelSelector.Content>
</ModelSelector.Root>
```

### Headless

```tsx
function MyModelMenu() {
  const selector = useModelSelector()
  return (
    <button
      onClick={() => selector.setOpen(!selector.open)}
      data-open={selector.open || undefined}
      className="anything"
    >
      {selector.selectedModel?.label ?? 'Select model'}
    </button>
  )
}
```

## Customization (eject path)

1. **L1** — the default appearance inside `<Chat />` (via `ChatInput.Model`).
2. **L2** — paste the preset composition (printed under *Anatomy*); restyle, reorder, or retag any part (`asChild`); the badge/logo/label nodes are replaceable via `.Item` children.
3. **L3** — drive your own elements from [`useModelSelector()`](../hooks/use-model-selector.md).

## Related

- [`AgentPicker`](./agent-picker.md) — same anatomy plus `.Create` / `.Manage` (and the shared popper-anchor open question)
- [`useModelSelector`](../hooks/use-model-selector.md)
- `ChatInput.Model` — the composer's model trigger (`models` on the leaf, `data-open`)
