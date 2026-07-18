# useStepIndicator

Step lifecycle state for a multi-step run — which steps are pending, active, and complete.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useStepIndicator } from 'veryfront/chat'
```

## Signature

```ts
function useStepIndicator(): UseStepIndicatorResult

type StepState = 'pending' | 'active' | 'complete'

interface UseStepIndicatorResult {
  // State — per-step lifecycle, mirrored as data-state on StepIndicator steps
  steps: Array<{ state: StepState }>
}
```

> The RFC specifies this hook as "step state" with the `data-state="pending|active|complete"` vocabulary; the exact result shape beyond that is not pinned down and will be finalized in the implementation issue.

## Options

This hook takes no options; step state comes from the surrounding context.

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `steps` | `Array<{ state: StepState }>` | Lifecycle per step. Each step is mirrored as `data-state="pending\|active\|complete"` on the `StepIndicator` items — style with CSS variants, never boolean props. |

### Actions

None specified in the RFC.

### Prop getters

None. Steps are display-only; hook state plus your own elements suffice.

## Example

```tsx
function MySteps() {
  const { steps } = useStepIndicator()
  return (
    <ol className="my-steps">
      {steps.map((step, i) => (
        <li
          key={i}
          data-state={step.state}
          className="my-step data-[state=active]:font-bold data-[state=complete]:opacity-60"
        >
          Step {i + 1}
        </li>
      ))}
    </ol>
  )
}
```

## Used by

- [`StepIndicator`](../components/step-indicator.md) — `.Root <ol>` · `.Rule <li>` · `.Label <span>`; steps carry `data-state`.

## Related

- [`useToolCall`](use-tool-call.md) — per-tool lifecycle within a step.
- [`useReasoning`](use-reasoning.md) — reasoning disclosure alongside steps.
