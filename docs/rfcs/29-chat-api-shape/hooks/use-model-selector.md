# useModelSelector

Context reader for the `ModelSelector` compound.

> **Status: RFC 29 - proposed; nothing on this page has landed.** Per-symbol truth, verified against `src/` by `deno task lint:rfc-status`:
>
> - **Exported from `veryfront/chat` today:** `useModelSelector`
> - **Not exported today:** none
>
> An exported symbol is not a landed delta - see [reading the status block](../README.md#reading-the-status-block). Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { useModelSelector } from "veryfront/chat";
```

## Signature

```ts
function useModelSelector(): ModelSelectorContext;
```

A **reader**: it reads the scoped context provided by `ModelSelector.Root` for the compound's parts. Per the providers contract, the raw context object stays unexported and providers render zero nodes.

## Options

None - state comes from the nearest `ModelSelector.Root`. The `models` config itself lives on the leaf/trigger (`<ModelSelector.Trigger models={…}>`), liftable to opt-in root context per the escalation rule (leaf wins).

## Returns

The `ModelSelector` compound's context - the state that `.Trigger`, `.Search`, `.List`, and `.Item` render from (surfaced on the DOM as `data-open` / `data-active` / `data-empty`):

```ts
{
  value?: string                 // selected "provider/model"
  selectedModel?: ModelOption    // resolved option (value match, else first model)
  onSelect: (value) => void      // select + close + onValueChange
  query: string                  // search text (feeds `.Search`)
  setQuery: (q: string) => void
  resolvedModels: ModelOption[]  // models filtered by `query` (feeds `.List`)
  open: boolean
  setOpen: (open: boolean) => void
  disabled?: boolean
}
```

Search surface (`query` / `setQuery` / `resolvedModels`) mirrors [`useAgentPicker`](use-agent-picker.md) - the `.Search` and `.List` parts read from it.

## Example

Drive your own element inside the compound:

```tsx
function MyModelOptions() {
  const selector = useModelSelector();
  return (
    <div className="anything">
      <button onClick={() => selector.setOpen(!selector.open)}>
        {selector.selectedModel?.label ?? "Select model"}
      </button>
    </div>
  );
}

<ModelSelector.Root value={model} onValueChange={setModel}>
  <ModelSelector.Trigger models={MODELS} />
  <ModelSelector.Content>
    <MyModelOptions />
  </ModelSelector.Content>
</ModelSelector.Root>;
```

## Used by

- [`ModelSelector`](../components/model-selector.md) - every part is a thin shell over this reader.

## Related

- [`ModelSelector`](../components/model-selector.md)
- [`useAgentPicker`](./use-agent-picker.md) - the agent counterpart
- `ChatInput.Model` - the composer's model trigger
