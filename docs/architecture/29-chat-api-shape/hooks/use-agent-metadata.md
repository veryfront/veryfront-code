# useAgentMetadata

Fetches metadata for a single agent by id.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAgentMetadata } from 'veryfront/chat'
```

## Signature

The existing signature is kept as today:

```ts
function useAgentMetadata(agentId: string): {
  agent: AgentMetadata | undefined
  isLoading: boolean
  error: Error | null
}
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `agentId` | `string` | The agent to fetch metadata for. |

## Returns

| Name | Type | Description |
| --- | --- | --- |
| `agent` | `AgentMetadata \| undefined` | The agent's metadata (responses pass through the `normalizeAgentMetadata` helper). |
| `isLoading` | `boolean` | Fetch in flight. |
| `error` | `Error \| null` | Fetch error, if any. |

## Example

```tsx
function AgentHeading({ agentId }: { agentId: string }) {
  const { agent, isLoading } = useAgentMetadata(agentId)
  if (isLoading || !agent) return null
  const items = getAgentPromptSuggestionItems(agent)
  return (
    <ChatEmptyState.Root>
      <ChatEmptyState.Heading>{agent.name}</ChatEmptyState.Heading>
      <ChatEmptyState.Suggestions>
        {items.map((item) => (
          <ChatEmptyState.Suggestion key={item.label}>{item.label}</ChatEmptyState.Suggestion>
        ))}
      </ChatEmptyState.Suggestions>
    </ChatEmptyState.Root>
  )
}
```

## Used by

- [`ChatEmptyState`](../components/chat-empty-state.md) compositions — source of the `agent` passed to `getAgentPromptSuggestionItems`
- [`AgentCard`](../components/agent-card.md) compositions

## Related

- [`useAgents`](./use-agents.md) — the full list
- [`useAgent`](./use-agent.md)
- `normalizeAgentMetadata` / `getAgentPromptSuggestionItems` — helpers
