# useAgents

Fetches the list of available agents.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAgents } from 'veryfront/chat'
```

## Signature

The existing signature is kept as today:

```ts
function useAgents(options?: { enabled?: boolean }): {
  agents: Agent[]
  isLoading: boolean
  error: Error | null
  refetch: () => void
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` (optional) | Whether the fetch runs. |

## Returns

| Name | Type | Description |
| --- | --- | --- |
| `agents` | `Agent[]` | The available agents (responses pass through the `normalizeAgentsListResponse` helper). |
| `isLoading` | `boolean` | Fetch in flight. |
| `error` | `Error \| null` | Fetch error, if any. |
| `refetch` | `() => void` | Re-run the fetch. |

## Example

```tsx
function AgentDirectory() {
  const { agents, isLoading, error, refetch } = useAgents()
  if (isLoading) return <Spinner />
  if (error) return <button onClick={refetch}>Retry</button>
  return (
    <ul>
      {agents.map((agent) => (
        <li key={agent.id}>{agent.name}</li>
      ))}
    </ul>
  )
}
```

Feed the result to the picker with the public helper:

```tsx
const { agents } = useAgents()
const options = agentsToPickerOptions(agents)
```

## Used by

- [`ChatAgentPicker`](../components/chat-agent-picker.md) — sources its option list (via `agentsToPickerOptions`)
- [`AgentPicker`](../components/agent-picker.md) compositions

## Related

- [`useAgentMetadata`](./use-agent-metadata.md) — one agent by id
- [`useAgent`](./use-agent.md)
- `agentsToPickerOptions` / `normalizeAgentsListResponse` — helpers
