# useAgent

Binds an agent to the session with lifecycle callbacks for tool activity and errors.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAgent } from 'veryfront/chat'
```

## Signature

The existing signature is kept as today:

```ts
function useAgent(options: {
  agent: Agent
  onToolCall?: (toolCall) => void
  onToolResult?: (toolResult) => void
  onError?: (error) => void
})
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `agent` | `Agent` | The agent to use. |
| `onToolCall` | function (optional) | Called when the agent invokes a tool. |
| `onToolResult` | function (optional) | Called when a tool result arrives. |
| `onError` | function (optional) | Called on agent error. |

## Returns

The existing return shape is kept as today (the RFC keeps this hook's signature unchanged and does not reshape it).

## Example

```tsx
function AgentSession({ agent }: { agent: Agent }) {
  useAgent({
    agent,
    onToolCall: (toolCall) => analytics.track('tool_call', toolCall),
    onError: (error) => console.error(error),
  })
  return <Chat agentId={agent.id} api="/api/ag-ui" />
}
```

## Used by

- Consumer applications wiring agent lifecycle callbacks around a chat session.

## Related

- [`useAgents`](./use-agents.md)
- [`useAgentMetadata`](./use-agent-metadata.md)
- `useChat` / `useConversationChat` — the session the agent drives
