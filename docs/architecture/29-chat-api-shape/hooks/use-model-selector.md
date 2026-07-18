# useModelSelector

Context reader for the `ModelSelector` compound.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useModelSelector } from 'veryfront/chat'
```

## Signature

```ts
function useModelSelector(): ModelSelectorContext
```

A **reader**: it reads the scoped context provided by `ModelSelector.Root` for the compound's parts. Per the providers contract, the raw context object stays unexported and providers render zero nodes.

## Options

None — state comes from the nearest `ModelSelector.Root`. The `models` config itself lives on the leaf/trigger (`<ModelSelector.Trigger models={…}>`), liftable to opt-in root context per the escalation rule (leaf wins).

## Returns

The `ModelSelector` compound's context — the state that `.Trigger`, `.Search`, `.List`, and `.Item` render from (surfaced on the DOM as `data-open` / `data-active` / `data-empty`). The RFC specifies this hook as the compound's reader; it lists no further return shape.

## Example

Drive your own element inside the compound:

```tsx
function MyModelOptions() {
  const selector = useModelSelector()
  return <div className="anything">{/* your markup from the selector context */}</div>
}

<ModelSelector.Root>
  <ModelSelector.Trigger models={MODELS} />
  <ModelSelector.Content>
    <MyModelOptions />
  </ModelSelector.Content>
</ModelSelector.Root>
```

## Used by

- [`ModelSelector`](../components/model-selector.md) — every part is a thin shell over this reader.

## Related

- [`ModelSelector`](../components/model-selector.md)
- [`useAgentPicker`](./use-agent-picker.md) — the agent counterpart
- `ChatInput.Model` — the composer's model trigger
