# useReasoning

Disclosure state for a reasoning part — auto-open while streaming, auto-close when done.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useReasoning } from 'veryfront/chat'
```

## Signature

```ts
function useReasoning(input?: { text: string; isStreaming?: boolean }): UseReasoningResult

interface UseReasoningResult {
  // State
  text: string
  open: boolean
  isStreaming: boolean
  duration: number
  // Actions
  toggle: () => void
  // Prop getters
  getTriggerProps: (overrides?: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.ButtonHTMLAttributes<HTMLButtonElement>
  getContentProps: (overrides?: React.HTMLAttributes<HTMLDivElement>) => React.HTMLAttributes<HTMLDivElement>
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `input` | `{ text: string; isStreaming?: boolean }` | nearest `Reasoning.Root` context | Explicit at L3 — the L3 eject works without a `Reasoning.Root` (mirrors `useToolCall(part?)` / `useSources(message?)`). Argless, the hook reads the surrounding `Reasoning` context (`Message.Reasoning` / `Reasoning` at L2). |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `text` | `string` | The reasoning text (from the explicit input at L3, or from context). |
| `open` | `boolean` | Disclosure state (mirrored as `data-open` on `Reasoning.Root`). Auto-opens while the reasoning streams, auto-closes when done. |
| `isStreaming` | `boolean` | Reasoning content is streaming now (mirrored as `data-streaming`). |
| `duration` | `number` | How long the model reasoned. **TBD:** how `duration` is measured (first-token → last-token wall clock vs. provider-reported) — nothing tracks it in today's source. |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `toggle` | `() => void` | Open/close the disclosure manually. |

### Prop getters

| Getter | Spreads onto | Description |
| --- | --- | --- |
| `getTriggerProps(overrides?)` | your trigger `<button>` | Toggle handler + disclosure a11y; standard merge semantics (handlers compose consumer-first, `className` merges, consumer wins). |
| `getContentProps(overrides?)` | your content element | Disclosure content wiring, same merge semantics. |

## Example

```tsx
function MyReasoning({ part }: { part: ReasoningPart }) {
  const reasoning = useReasoning({ text: part.text, isStreaming: part.state === 'streaming' })   // explicit at L3 — no Reasoning.Root needed
  return (
    <div className="my-reasoning" data-open={reasoning.open || undefined}>
      <button {...reasoning.getTriggerProps({ className: 'my-trigger' })}>
        {reasoning.isStreaming ? 'Thinking…' : `Thought for ${reasoning.duration}s`}
      </button>
      {reasoning.open && (
        <div {...reasoning.getContentProps({ className: 'my-content' })}>
          {reasoning.text}
        </div>
      )}
    </div>
  )
}
```

## Used by

- [`Reasoning`](../components/reasoning.md) — `.Root` (`data-open`, `data-streaming`) · `.Trigger` · `.Content`. Also available as `Message.Reasoning` (same component, namespace re-export).

## Related

- [`useMessageParts`](use-message-parts.md) — where reasoning parts come from (`isReasoningPart`).
- [`useToolCall`](use-tool-call.md) — the same disclosure pattern for tool parts.
