# StepIndicator

A labelled divider between an assistant turn's steps, with per-step lifecycle state. Render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { StepIndicator } from 'veryfront/chat'
// every sub-part is also a flat named export (same function), with its props type:
import { StepIndicator, StepIndicatorLabel, type StepIndicatorLabelProps } from 'veryfront/chat'
```

## Parts index

- [`.Root`](#stepindicatorroot--changed) — `changed`: `<div>` → `<ol>`; `isComplete` boolean → `data-state`; `icon` deleted
- [`.Rule`](#stepindicatorrule--changed) — `changed`: `<div>` → `<li>`
- [`.Label`](#stepindicatorlabel--changed) — `changed`: `<div>` → `<span>`; `icon` override → children

## Anatomy

```tsx
<StepIndicator.Root>        {/* proposed <ol>; today a <div> flex row — ONE per step boundary */}
  <StepIndicator.Rule />    {/* proposed <li>; the leading horizontal rule */}
  <StepIndicator.Label />   {/* status glyph + "Step N" pill — a sibling BETWEEN the rules, never nested */}
  <StepIndicator.Rule />    {/* the trailing rule */}
</StepIndicator.Root>
```

`<StepIndicator>` with **no children renders the default anatomy**: `Rule` → `Label` → `Rule` — a horizontal rule broken by a centered step pill. Pass children to recompose.

> **Proposed restructure.** Today's component is *one divider per step boundary*: a `<div>` taking `stepIndex` + `isComplete` and rendering rule–pill–rule. The RFC recasts it as list semantics — `.Root <ol>` · `.Rule <li>` · `.Label <span>` — with the boolean `isComplete` replaced by `data-state="pending|active|complete"`. Resolved: `.Root` stays **one element per step boundary** (the list semantics are for accessibility, not a turn-wide list of steps); step boundaries derive from the message's `step-start` parts, and `active` is the latest boundary while the message streams.

## Default DOM (childless render)

The actual HTML of `<StepIndicator stepIndex={1} isComplete />` today (classes abbreviated to layout-relevant ones):

```html
<div class="flex items-center gap-3 py-3 text-xs">                <!-- .Root — in-flow flex row, vertically centered, gap-3 -->
  <div class="flex-1 h-px bg-edge"></div>                         <!-- .Rule — grows; absorbs half the free width, 1px tall -->
  <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full border">  <!-- .Label — fixed-size pill, flex row gap-1.5 -->
    <svg class="size-3.5" />                                      <!--   complete: green check icon -->
    <!-- …or, when not complete: -->
    <!-- <span class="size-2 rounded-full animate-pulse"></span>       pending: pulsing dot -->
    <span class="font-medium">Step 2</span>                       <!--   label text: stepIndex + 1 -->
  </div>
  <div class="flex-1 h-px bg-edge"></div>                         <!-- .Rule — second rule, mirrors the first -->
</div>
```

No absolute positioning, no conditional parts — everything always renders; only the glyph inside `.Label` switches with state. The two `flex-1` rules make the pill self-center at any container width.

## Parts

### `StepIndicator.Root` — `changed`

Changed: today's `<div>` flex row becomes an `<ol>`, the `isComplete` boolean becomes `data-state="pending|active|complete"`, and the `icon` prop is deleted.

The container + the compound's scoped context. Today one `<div>` flex row; **proposed `<ol>`**. Step data enters here; sub-parts read it from context.

**Layout:** in-flow flex row (`items-center gap-3`), full width, vertical padding; no positioning context.

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `stepIndex` *(required)* | `number` | — | Zero-based; `.Label` renders `Step {stepIndex + 1}`. |
| ~~`isComplete`~~ | `boolean` | — | **Removed (proposed):** the boolean prop becomes `data-state="pending\|active\|complete"` — style off the attribute, no boolean-prop variants. Today it switches the `.Label` glyph (green check vs. pulsing dot). |
| ~~`icon`~~ | `ReactNode` | — | **Removed** (today overrides the complete/pending glyph via context). The RFC bans `icon` slot props; pass children to `StepIndicator.Label` instead. |
| `asChild` *(proposed)* | `boolean` | `false` | Merge the root node onto your own element. |
| + native | `React.HTMLAttributes` (today `<div>`, proposed `<ol>`) · `ref` | — | Spread onto the single node; `className` merges (last). |

**State attributes (proposed):**

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-state` | `pending \| active \| complete` | Step lifecycle, on each step. Today the state is presented only visually (check icon vs. pulsing dot), and only two of the three states exist — `active` is a proposed addition. |

```css
[data-state='pending'] { opacity: 0.5; }
[data-state='active'] { font-weight: 600; }
[data-state='complete'] .check { display: inline; }
```

### `StepIndicator.Rule` — `changed`

One of the flanking horizontal rules. Today a `<div>`; **proposed `<li>`**. Default content: none — it *is* the 1px line. Always renders; two appear in the default anatomy, one either side of the label.

**Layout:** in-flow flex child, `flex-1 h-px` — each rule absorbs half the free width, which is what centers the pill.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` *(proposed)* | | Own the node. Today the part takes only `className`. |

### `StepIndicator.Label` — `changed`

The step pill. Today a `<div>`; **proposed `<span>`**. Default content: status glyph — green `CheckCircle` when complete, a 2px-dot pulsing while pending *(the `active` glyph is TBD)* — followed by the text `Step {stepIndex + 1}`. Always renders.

**Layout:** in-flow flex child between the rules; fixed-size bordered pill (`flex items-center gap-1.5`), does not grow or shrink.

| Prop | Type | Description |
| --- | --- | --- |
| `children` *(proposed)* | `ReactNode` | Replaces the default glyph + `Step N` text (read `stepIndex` from `useStepIndicator()`). Today only `className` is accepted; the glyph override rode the removed `icon` prop. |
| `asChild` + native + `ref` *(proposed)* | | Own the node. |

## Context (what the parts read)

`useStepIndicator()` — a **per-boundary context reader**; throws outside a `StepIndicator`:

```ts
{
  stepIndex: number
  state: 'pending' | 'active' | 'complete'   // proposed — drives data-state
}
```

Steps derive from the message's `step-start` parts; `state: 'active'` is the latest boundary while the message streams. No prop getters — the component has no interactivity. One shape, shared with [`useStepIndicator`](../hooks/use-step-indicator.md).

*Grounding:* today's context is `{ stepIndex, isComplete, icon }`. The RFC replaces the boolean + icon slot with the three-value `state`.

## Examples

### Default

Step rendering ships as part of the public `<Chat>` composition's defaults.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

One `StepIndicator` per step boundary; `.Label` is a sibling *between* the two `.Rule`s, never nested inside one:

```tsx
<StepIndicator.Root stepIndex={stepIndex} className="my-step">
  <StepIndicator.Rule className="my-step-rule" />
  <StepIndicator.Label className="my-step-label">Searching</StepIndicator.Label>
  <StepIndicator.Rule className="my-step-rule" />
</StepIndicator.Root>
```

Style each step off `[data-state]` — no boolean props.

### Headless (L3)

The hook is a per-boundary context reader, so a custom divider sits inside a `StepIndicator.Root`:

```tsx
function MyStepDivider() {
  const { stepIndex, state } = useStepIndicator()   // per-boundary; throws outside a StepIndicator
  return (
    <div className="anything" data-state={state}>
      Step {stepIndex + 1}
    </div>
  )
}

<StepIndicator.Root stepIndex={stepIndex}>
  <MyStepDivider />
</StepIndicator.Root>
```

`useStepIndicator()` returns `{ stepIndex, state }` — the per-boundary state that drives `data-state="pending|active|complete"`.

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the step rendering.
2. **L2:** compose `StepIndicator.*` with your own labels and layout; swap nodes via `asChild`.
3. **L3:** `useStepIndicator()` (per-boundary `{ stepIndex, state }`) + your own markup inside a `StepIndicator.Root`.

## Related

- [`useStepIndicator`](../hooks/use-step-indicator.md) — step state
- [Message](./message.md) · [ToolCall](./tool-call.md)
