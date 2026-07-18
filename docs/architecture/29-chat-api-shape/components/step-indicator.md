# StepIndicator

An ordered list of steps with per-step lifecycle state.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { StepIndicator } from 'veryfront/chat'
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`.

```tsx
<StepIndicator.Root>
  <StepIndicator.Rule>
    <StepIndicator.Label />
  </StepIndicator.Rule>
</StepIndicator.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `StepIndicator.Root` | `<ol>` | — | The step list. |
| `StepIndicator.Rule` | `<li>` | `data-state` | One step. |
| `StepIndicator.Label` | `<span>` | — | The step's label. |

## Props (`StepIndicator.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the root node onto your own element. |
| …rest | native `<ol>` attributes | Spread onto the root — `className`, `data-*`, `aria-*`, handlers, `ref`. |

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-state` | `pending \| active \| complete` | Step lifecycle, on each step. |

```css
[data-state='pending'] { opacity: 0.5; }
[data-state='active'] { font-weight: 600; }
[data-state='complete'] .check { display: inline; }
```

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
