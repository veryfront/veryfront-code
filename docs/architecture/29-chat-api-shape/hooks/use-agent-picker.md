# useAgentPicker

Context reader for the `AgentPicker` compound: search query, filtered options, and selection.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAgentPicker } from 'veryfront/chat'
```

## Signature

```ts
function useAgentPicker(): AgentPickerContext & {
  query: string
  setQuery: (query: string) => void
  options: AgentOption[]
  select: (option: AgentOption) => void
}
```

`AgentOption = { id, name, description?, avatarUrl?, disabled? }` — the same option type `AgentPicker.Root` takes.

A **context reader plus picker state**: it reads the scoped context provided by `AgentPicker.Root` and exposes the search/selection surface. Per the providers contract, the raw context object stays unexported.

## Options

None — state comes from the nearest `AgentPicker.Root`.

## Returns

| Name | Type | Description |
| --- | --- | --- |
| `value` | `string \| undefined` | Selected agent id. |
| `onSelect` | `(id: string) => void` | Select an agent by id and close (also fires the Root's `onValueChange`). |
| `open` | `boolean` | Popover open state (surfaced on the DOM as `data-open` on `.Trigger`). |
| `setOpen` | `(open: boolean) => void` | Set the open state (also fires `onOpenChange`). |
| `onCreate` | `(() => void) \| undefined` | Present only when the Root received it. |
| `onManage` | `(() => void) \| undefined` | Present only when the Root received it. |
| `query` | `string` | The current search query. |
| `setQuery` | `(query: string) => void` | Update the search query. |
| `options` | `AgentOption[]` | The (filtered) picker options. |
| `select` | `(option: AgentOption) => void` | Select an option. |

## Example

Render your own search and option list inside the compound:

```tsx
function MyOptions() {
  const picker = useAgentPicker()
  return (
    <>
      <input
        value={picker.query}
        onChange={(event) => picker.setQuery(event.target.value)}
        className="anything"
      />
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

<AgentPicker.Root agents={agents}>
  <AgentPicker.Trigger />
  <AgentPicker.Content>
    <MyOptions />
  </AgentPicker.Content>
</AgentPicker.Root>
```

## Used by

- [`AgentPicker`](../components/agent-picker.md) — `.Search`, `.List`, and `.Item` are thin shells over this hook, so the two can never drift.
- [`ChatAgentPicker`](../components/chat-agent-picker.md) — the preset over the same compound.

## Related

- [`AgentPicker`](../components/agent-picker.md)
- [`useAgents`](./use-agents.md) — the agents behind the options
- `agentsToPickerOptions` — maps agents to picker options
