# ModelSelector

A searchable popover for choosing a model, configured on the leaf that uses it.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ModelSelector } from 'veryfront/chat'
```

## Anatomy

The same anatomy as [`AgentPicker`](./agent-picker.md), minus `.Create` and `.Manage`:

```tsx
<ModelSelector.Root>
  <ModelSelector.Trigger />
  <ModelSelector.Content>
    <ModelSelector.Search />
    <ModelSelector.List>
      <ModelSelector.Item />
    </ModelSelector.List>
  </ModelSelector.Content>
</ModelSelector.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ModelSelector.Root` | provider (popper root) | — | Scoped context provider; positions `.Content`. Subject to the same popper-anchor open question as `AgentPicker.Root`. |
| `ModelSelector.Trigger` | `<button>` | `data-open` | Opens and closes the selector. Accepts the `models` config (config lives on the leaf). |
| `ModelSelector.Content` | `<div>` | — | The popover panel. |
| `ModelSelector.Search` | `<input>` | — | Filter input driving the option query. |
| `ModelSelector.List` | `<ul>` | `data-empty` | Option list container. |
| `ModelSelector.Item` | `<button>` | `data-active` | One selectable model option. |

## Props

Every part follows the library-wide node contract: `extends` its element's native React attributes, spreads `{...props}` onto its single node, takes `asChild` and `ref`; `className` merges Tailwind-aware; handlers compose (consumer first, `preventDefault` cancels internal).

### `models` — config on the leaf, liftable

Per the RFC's config escalation rule:

- **Default:** `models` is passed on the leaf/trigger that uses it — `<ModelSelector.Trigger models={MODELS} />`. Config lives on the component that uses it, never threaded through a required root.
- **Opt-in lift:** when more than one leaf needs the same `models`, it may be lifted to opt-in root context (`<ModelSelector.Root models={MODELS}>`).
- **Precedence:** the leaf prop always wins over lifted root context (explicit prop > nearest context > default).

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-open` | `.Trigger` | Selector is expanded. |
| `data-active` | `.Item` | Item is the current selection. |
| `data-empty` | `.List` | Zero options. |

## Examples

### Default

Inside the composer, the model trigger is `ChatInput.Model` with `models` on the leaf:

```tsx
<ChatInput.Model models={MODELS} />
```

### Composed

```tsx
<ModelSelector.Root>
  <ModelSelector.Trigger models={MODELS} className="my-trigger" />
  <ModelSelector.Content className="my-panel">
    <ModelSelector.Search placeholder="Search models…" />
    <ModelSelector.List />
  </ModelSelector.Content>
</ModelSelector.Root>
```

### Headless

[`useModelSelector()`](../hooks/use-model-selector.md) is the compound's context reader — render your own trigger and options against it:

```tsx
function MyModelMenu() {
  const selector = useModelSelector()
  // render your own elements from the selector state
  return <div className="anything">{/* your markup */}</div>
}
```

## Customization (eject path)

1. **L1** — the default appearance inside `<Chat />` (via `ChatInput.Model`).
2. **L2** — paste the public composition; restyle, reorder, or retag any part (`asChild`).
3. **L3** — drive your own elements from [`useModelSelector()`](../hooks/use-model-selector.md).

## Related

- [`AgentPicker`](./agent-picker.md) — same anatomy plus `.Create` / `.Manage`
- [`useModelSelector`](../hooks/use-model-selector.md)
- `ChatInput.Model` — the composer's model trigger (`models` on the leaf, `data-open`)
