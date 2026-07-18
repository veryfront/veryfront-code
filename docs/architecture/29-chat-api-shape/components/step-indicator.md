# StepIndicator

A labelled divider between an assistant turn's steps, with per-step lifecycle state. Render it whole, or compose the parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { StepIndicator } from 'veryfront/chat'
```

## Anatomy

```tsx
<StepIndicator.Root>       {/* proposed <ol>; today a <div> flex row */}
  <StepIndicator.Rule>     {/* proposed <li>; a flanking horizontal rule */}
    <StepIndicator.Label /> {/* status glyph + "Step N" pill */}
  </StepIndicator.Rule>
</StepIndicator.Root>
```

`<StepIndicator>` with **no children renders the default anatomy**: `Rule` → `Label` → `Rule` — a horizontal rule broken by a centered step pill. Pass children to recompose.

> **Proposed restructure.** Today's component is *one divider per step boundary*: a `<div>` taking `stepIndex` + `isComplete` and rendering rule–pill–rule. The RFC recasts it as list semantics — `.Root <ol>` · `.Rule <li>` · `.Label <span>` — with the boolean `isComplete` replaced by `data-state="pending|active|complete"`. **TBD:** whether the proposed `.Root` hosts *all* steps of a turn (a real `<ol>` of steps) or remains one element per boundary with list semantics for accessibility only; and how `active` is derived (today's data model is binary complete/pending — `active` has no source equivalent yet).

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

### `StepIndicator.Root`

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

### `StepIndicator.Rule`

One of the flanking horizontal rules. Today a `<div>`; **proposed `<li>`**. Default content: none — it *is* the 1px line. Always renders; two appear in the default anatomy, one either side of the label.

**Layout:** in-flow flex child, `flex-1 h-px` — each rule absorbs half the free width, which is what centers the pill.

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` + native + `ref` *(proposed)* | | Own the node. Today the part takes only `className`. |

### `StepIndicator.Label`

The step pill. Today a `<div>`; **proposed `<span>`**. Default content: status glyph — green `CheckCircle` when complete, a 2px-dot pulsing while pending *(the `active` glyph is TBD)* — followed by the text `Step {stepIndex + 1}`. Always renders.

**Layout:** in-flow flex child between the rules; fixed-size bordered pill (`flex items-center gap-1.5`), does not grow or shrink.

| Prop | Type | Description |
| --- | --- | --- |
| `children` *(proposed)* | `ReactNode` | Replaces the default glyph + `Step N` text (read `stepIndex` from `useStepIndicator()`). Today only `className` is accepted; the glyph override rode the removed `icon` prop. |
| `asChild` + native + `ref` *(proposed)* | | Own the node. |

## Context (what the parts read)

`useStepIndicator()` — throws outside a `StepIndicator`:

```ts
{
  stepIndex: number
  state: 'pending' | 'active' | 'complete'   // proposed — drives data-state
}
```

*Grounding:* today's context is `{ stepIndex, isComplete, icon }`. The RFC replaces the boolean + icon slot with the three-value `state`. **TBD:** the exact hook return shape (whether prop getters are needed for a component with no interactivity).

## Examples

### Default

Step rendering ships as part of the public `<Chat>` composition's defaults.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<StepIndicator.Root className="my-steps">
  <StepIndicator.Rule className="my-step">
    <StepIndicator.Label className="my-step-label">Searching</StepIndicator.Label>
  </StepIndicator.Rule>
  <StepIndicator.Rule className="my-step">
    <StepIndicator.Label className="my-step-label">Summarizing</StepIndicator.Label>
  </StepIndicator.Rule>
</StepIndicator.Root>
```

Style each step off `[data-state]` — no boolean props.

### Headless (L3)

```tsx
function MySteps() {
  const steps = useStepIndicator()   // step state (pending | active | complete per step)
  return (
    <ol className="anything">
      {/* map the hook's step state to your own <li> elements */}
    </ol>
  )
}
```

`useStepIndicator()` returns the step state that drives `data-state="pending|active|complete"`.

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the step rendering.
2. **L2:** compose `StepIndicator.*` with your own labels and layout; swap nodes via `asChild`.
3. **L3:** `useStepIndicator()` + your own list markup.

## Related

- [`useStepIndicator`](../hooks/use-step-indicator.md) — step state
- [Message](./message.md) · [ToolCall](./tool-call.md)
