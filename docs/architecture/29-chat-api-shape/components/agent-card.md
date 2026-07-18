# AgentCard

A card displaying an agent's identity, reasoning, and tools.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AgentCard } from 'veryfront/chat'
```

## Anatomy

Today's parts are kept:

```tsx
<AgentCard.Root>
  <AgentCard.Header />
  <AgentCard.Reasoning />
  <AgentCard.Tools />
  <AgentCard.Body />
</AgentCard.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `AgentCard.Root` | `<div>` | — | The card container; provides the compound's scoped context. |
| `AgentCard.Header` | one node | — | Agent identity header. |
| `AgentCard.Reasoning` | one node | — | The agent's reasoning section. |
| `AgentCard.Tools` | one node | — | The agent's tools section. |
| `AgentCard.Body` | one node | — | The card body. |

## Props

Every part follows the library-wide node contract: `extends` its element's native React attributes, spreads `{...props}` onto its single node, takes `asChild` and `ref`; `className` merges Tailwind-aware; handlers compose (consumer first, `preventDefault` cancels internal). There is no `xxxClassName` / `xxxProps` bag and no hidden wrapper node — every layout div between the parts is yours.

## State attributes

None specific to this compound. The global `data-*` vocabulary applies where relevant.

## Examples

### Default

```tsx
<AgentCard.Root />
```

### Composed

```tsx
<AgentCard.Root className="my-card">
  <AgentCard.Header className="my-header" />
  <div className="my-columns">{/* YOUR div */}
    <AgentCard.Reasoning />
    <AgentCard.Tools />
  </div>
  <AgentCard.Body />
</AgentCard.Root>
```

### Headless

[`useAgentCard()`](../hooks/use-agent-card.md) is the compound's context reader; agent data itself comes from [`useAgentMetadata`](../hooks/use-agent-metadata.md) / [`useAgents`](../hooks/use-agents.md) — render your own card from those:

```tsx
function MyAgentCard({ agentId }: { agentId: string }) {
  const { agent, isLoading } = useAgentMetadata(agentId)
  if (isLoading) return null
  return <section className="anything">{/* your markup from agent */}</section>
}
```

## Customization (eject path)

1. **L1** — the default card as rendered by the presets.
2. **L2** — paste the public composition; every part is a single node you can class, attribute, or retag (`asChild`); layout divs are yours.
3. **L3** — build your own card from [`useAgentCard()`](../hooks/use-agent-card.md) and [`useAgentMetadata`](../hooks/use-agent-metadata.md).

## Related

- [`useAgentCard`](../hooks/use-agent-card.md)
- [`useAgentMetadata`](../hooks/use-agent-metadata.md)
- [`useAgents`](../hooks/use-agents.md)
- [`AgentPicker`](./agent-picker.md)
