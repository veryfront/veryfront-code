# useAgents

Fetches the list of available agents.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useAgents`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

> **⚠ Reusability flag** (see [generic core vs veryfront adapter](../../29-chat-api-shape.md)): this hook is hard-wired to veryfront's `/api/agents` backend - fetch, envelope normalizers, and error registry - so it is **not generic as "signature kept" implies**. Move it to a veryfront adapter, or require an injected `transport`/`fetcher` and document the backend contract.

## Import

```tsx
import { useAgents } from "veryfront/chat";
```

## Signature

The existing signature is kept as today:

```ts
function useAgents(options?: { enabled?: boolean }): {
  agents: AgentMetadata[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
};
```

## Options

| Option    | Type                 | Description             |
| --------- | -------------------- | ----------------------- |
| `enabled` | `boolean` (optional) | Whether the fetch runs. |

## Returns

| Name        | Type              | Description                                                                             |
| ----------- | ----------------- | --------------------------------------------------------------------------------------- |
| `agents`    | `AgentMetadata[]` | The available agents (responses pass through the `normalizeAgentsListResponse` helper). |
| `isLoading` | `boolean`         | Fetch in flight.                                                                        |
| `error`     | `Error \| null`   | Fetch error, if any.                                                                    |
| `refetch`   | `() => void`      | Re-run the fetch.                                                                       |

## Example

```tsx
function AgentDirectory() {
  const { agents, isLoading, error, refetch } = useAgents();
  if (isLoading) return <Spinner />;
  if (error) return <button onClick={refetch}>Retry</button>;
  return (
    <ul>
      {agents.map((agent) => <li key={agent.id}>{agent.name}</li>)}
    </ul>
  );
}
```

Feed the result to the picker with the public helper:

```tsx
const { agents } = useAgents();
const options = agentsToPickerOptions(agents);
```

## Used by

- [`ChatAgentPicker`](../components/chat-agent-picker.md) - sources its option list (via `agentsToPickerOptions`)
- [`AgentPicker`](../components/agent-picker.md) compositions

## Related

- [`useAgentMetadata`](./use-agent-metadata.md) - one agent by id
- [`useAgent`](./use-agent.md)
- `agentsToPickerOptions` / `normalizeAgentsListResponse` - helpers
