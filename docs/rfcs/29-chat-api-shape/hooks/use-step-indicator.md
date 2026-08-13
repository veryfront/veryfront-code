# useStepIndicator

Step lifecycle state for one step boundary of a multi-step run - pending, active, or complete.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useStepIndicator`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useStepIndicator } from "veryfront/chat";
```

## Signature

```ts
function useStepIndicator(step?: { stepIndex: number; state: StepState }): UseStepIndicatorResult;

type StepState = "pending" | "active" | "complete";

interface UseStepIndicatorResult {
  // State - this boundary's lifecycle, mirrored as data-state on the StepIndicator
  stepIndex: number;
  state: StepState;
}
```

> A **per-boundary reader** - one hook call per step boundary. Steps derive from the message's `step-start` parts; `'active'` is the latest boundary while the message streams. One shape, shared with the [`StepIndicator`](../components/step-indicator.md) context section.

## Options

Explicit at L3, context at L2 - the same **explicit arg › nearest context › default** precedence the other readers follow (mirrors `useToolCall(part?)` / `useSources(message?)` / `useReasoning(input?)`).

| Option | Type                                      | Default                              | Description                                                                                                                                             |
| ------ | ----------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `step` | `{ stepIndex: number; state: StepState }` | nearest `StepIndicator.Root` context | Pass the boundary explicitly so the L3 eject works **without** a `StepIndicator.Root`. Argless, the hook reads the surrounding `StepIndicator` context. |

## Returns

### State

| Name        | Type        | Description                                                                                                                                                                                                          |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stepIndex` | `number`    | Zero-based index of this step boundary, derived from the message's `step-start` parts.                                                                                                                               |
| `state`     | `StepState` | This boundary's lifecycle - `'active'` is the latest boundary while the message streams. Mirrored as `data-state="pending\|active\|complete"` on the `StepIndicator` - style with CSS variants, never boolean props. |

### Actions

None specified in the RFC.

### Prop getters

None. Steps are display-only; hook state plus your own elements suffice.

## Example

A custom divider composed inside a `StepIndicator` (the hook reads that boundary's context):

```tsx
function MyStepDivider() {
  const { stepIndex, state } = useStepIndicator();
  return (
    <div
      data-state={state}
      className="my-step data-[state=active]:font-bold data-[state=complete]:opacity-60"
    >
      Step {stepIndex + 1}
    </div>
  );
}

<StepIndicator.Root stepIndex={stepIndex}>
  <MyStepDivider />
</StepIndicator.Root>;
```

## Used by

- [`StepIndicator`](../components/step-indicator.md) - `.Root <div role="separator">` · `.Rule <span aria-hidden>` · `.Label <span>` (one per step boundary); the root carries `data-state`.

## Related

- [`useToolCall`](use-tool-call.md) - per-tool lifecycle within a step.
- [`useReasoning`](use-reasoning.md) - reasoning disclosure alongside steps.
