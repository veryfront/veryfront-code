# useStepIndicator

Step lifecycle state for one step boundary of a multi-step run — pending, active, or complete.

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
  // State — this boundary's lifecycle, mirrored as data-state on the StepIndicator
  stepIndex: number
  state: StepState
}
```

> A **per-boundary context reader** — one hook call per step boundary, inside a `StepIndicator`. Steps derive from the message's `step-start` parts; `'active'` is the latest boundary while the message streams. One shape, shared with the [`StepIndicator`](../components/step-indicator.md) context section.

## Options

This hook takes no options; it reads the surrounding `StepIndicator` context (and throws outside one).

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `stepIndex` | `number` | Zero-based index of this step boundary, derived from the message's `step-start` parts. |
| `state` | `StepState` | This boundary's lifecycle — `'active'` is the latest boundary while the message streams. Mirrored as `data-state="pending\|active\|complete"` on the `StepIndicator` — style with CSS variants, never boolean props. |

### Actions

None specified in the RFC.

### Prop getters

None. Steps are display-only; hook state plus your own elements suffice.

## Example

A custom divider composed inside a `StepIndicator` (the hook reads that boundary's context):

```tsx
function MyStepDivider() {
  const { stepIndex, state } = useStepIndicator()
  return (
    <div
      data-state={state}
      className="my-step data-[state=active]:font-bold data-[state=complete]:opacity-60"
    >
      Step {stepIndex + 1}
    </div>
  )
}

<StepIndicator.Root stepIndex={stepIndex}>
  <MyStepDivider />
</StepIndicator.Root>
```

## Used by

- [`StepIndicator`](../components/step-indicator.md) — `.Root <ol>` · `.Rule <li>` · `.Label <span>` (one per step boundary); each carries `data-state`.

## Related

- [`useToolCall`](use-tool-call.md) — per-tool lifecycle within a step.
- [`useReasoning`](use-reasoning.md) — reasoning disclosure alongside steps.
