# useToolCall

Tool-call lifecycle state, disclosure behaviour, and prop getters for a tool part — typed per tool name.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useToolCall } from 'veryfront/chat'
```

## Signature

```ts
function useToolCall<TTools = DefaultTools>(
  part?: ToolPart<TTools>
): UseToolCallResult<TTools>

type ToolCallState =
  | 'input-streaming'
  | 'input-available'
  | 'output-available'
  | 'output-error'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-denied'

interface UseToolCallResult<TTools> {
  // State
  part: ToolPart<TTools>
  state: ToolCallState
  input: Partial<ToolInput<TTools>>   // partial while streaming
  output: ToolOutput<TTools> | undefined
  error: unknown
  isOpen: boolean
  // Actions
  toggle: () => void
  // Prop getters
  getTriggerProps: (overrides?: React.ButtonHTMLAttributes<HTMLButtonElement>) => React.ButtonHTMLAttributes<HTMLButtonElement>
  getBodyProps: (overrides?: React.HTMLAttributes<HTMLDivElement>) => React.HTMLAttributes<HTMLDivElement>
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `part` | `ToolPart<TTools>` | nearest `ToolCall` context | Explicit at L3; from context at L2. `TTools` narrows `input`/`output` per tool name (`part.type === 'tool-…'`) — a wrong renderer signature against the typed tools registry is a compile error. |

## Returns

### State

| Name | Type | Description |
| --- | --- | --- |
| `part` | `ToolPart<TTools>` | The resolved tool part. |
| `state` | `ToolCallState` | Full lifecycle, including human-in-the-loop approval states. Mirrored as `data-state` on `ToolCall.Root`. |
| `input` | `Partial<ToolInput<TTools>>` | Tool arguments — **partial while streaming** (`input-streaming`). |
| `output` | `ToolOutput<TTools> \| undefined` | Tool result once `output-available`. |
| `error` | `unknown` | Error when `output-error`. |
| `isOpen` | `boolean` | Disclosure state (mirrored as `data-open`; auto-opens on completion). |

### Actions

| Name | Type | Description |
| --- | --- | --- |
| `toggle` | `() => void` | Open/close the disclosure. |

### Prop getters

| Getter | Spreads onto | Description |
| --- | --- | --- |
| `getTriggerProps(overrides?)` | your trigger `<button>` | Toggle handler + disclosure a11y. Merge semantics apply: pass your props *in* — handlers compose (consumer first, `preventDefault` cancels internal), `className` merges Tailwind-aware, consumer wins. |
| `getBodyProps(overrides?)` | your collapsible body element | Disclosure body wiring, same merge semantics. |

## Example

```tsx
function MyToolCard({ part }: { part: ToolPart<MyTools> }) {
  const tool = useToolCall<MyTools>(part)   // part explicit at L3
  return (
    <div className="my-tool" data-state={tool.state}>
      <button
        {...tool.getTriggerProps({
          className: 'my-trigger',
          onClick: () => track('tool-toggled'),   // composes; runs before internal toggle
        })}
      >
        {tool.part.type} — {tool.state}
      </button>
      {tool.isOpen && (
        <div {...tool.getBodyProps({ className: 'my-body' })}>
          <pre>{JSON.stringify(tool.input, null, 2)}</pre>
          {tool.state === 'output-available' && <output>{String(tool.output)}</output>}
          {tool.state === 'output-error' && <p role="alert">{String(tool.error)}</p>}
        </div>
      )}
    </div>
  )
}
```

Rendering resolution when a tool part is displayed: inline render fn → `tools` registry by name → default renderer.

## Used by

- [`ToolCall`](../components/tool-call.md) — `.Root` (`data-state`, `data-open`) · `.Trigger` · `.Body` · `.Input` · `.Output` · `.Error`.

## Related

- [`useMessageParts`](use-message-parts.md) — where tool parts come from.
- Helpers: `isToolPart`, `isSkillToolPart`, `mergeProps` (compose several hooks onto one element).
