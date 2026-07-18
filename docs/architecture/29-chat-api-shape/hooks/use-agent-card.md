# useAgentCard

Context reader for the `AgentCard` compound.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useAgentCard } from 'veryfront/chat'
```

## Signature

```ts
function useAgentCard(): AgentCardContext
```

A **reader**: it reads the scoped context provided by `AgentCard.Root` for the card's parts. Per the providers contract, the raw context object stays unexported and providers render zero nodes.

## Options

None.

## Returns

The `AgentCard` compound's context — the card state that `AgentCard.Header` / `.Reasoning` / `.Tools` / `.Body` render from. (The RFC specifies this hook as the compound's reader; it lists no further return shape.)

## Example

Use it inside an `AgentCard.Root` to drive your own element alongside the built-in parts:

```tsx
function MyCardExtras() {
  const card = useAgentCard()
  return <div className="anything">{/* your markup from the card context */}</div>
}

<AgentCard.Root>
  <AgentCard.Header />
  <MyCardExtras />
  <AgentCard.Body />
</AgentCard.Root>
```

## Used by

- [`AgentCard`](../components/agent-card.md) — every part is a thin shell over this reader.

## Related

- [`AgentCard`](../components/agent-card.md)
- [`useAgentMetadata`](./use-agent-metadata.md) — agent data outside the compound
