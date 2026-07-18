# ChatAgentPicker

The batteries-included preset over `AgentPicker`, wired to your agents list.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatAgentPicker, agentsToPickerOptions } from 'veryfront/chat'
```

## Anatomy

`ChatAgentPicker` is a **preset**: it renders the public [`AgentPicker`](./agent-picker.md) composition with sensible defaults. Its default composition is public — ejecting means pasting that composition and editing the piece you care about.

```tsx
<ChatAgentPicker />
```

Under the hood it composes:

```tsx
<AgentPicker.Root>
  <AgentPicker.Trigger />
  <AgentPicker.Content>
    <AgentPicker.Search />
    <AgentPicker.List>
      <AgentPicker.Item />
    </AgentPicker.List>
    <AgentPicker.Create />
    <AgentPicker.Manage />
  </AgentPicker.Content>
</AgentPicker.Root>
```

## Parts

`ChatAgentPicker` has no parts of its own — it is a preset over the `AgentPicker` compound. See the [`AgentPicker` parts table](./agent-picker.md#parts).

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatAgentPicker` | the `AgentPicker` composition | (inherited) | Preset; everything it renders is reachable, public L2. |

## Props

Follows the library-wide node contract (`extends` native attributes, single-node spread, `asChild`, `ref`, Tailwind-aware `className` merge, composed handlers). Boolean state props from today's surface (`selected` / `isLoading` / `invalid`) are replaced by `data-*` attributes; `inputStyle` is deleted.

### `agentsToPickerOptions` (public helper)

The pure mapping the preset uses to turn agents into picker options is exported:

```ts
agentsToPickerOptions(agents) // → picker options
```

Use it when composing `AgentPicker` yourself so your option list matches the preset's.

## State attributes

Inherited from `AgentPicker`: `data-open` (`.Trigger`), `data-active` (`.Item`), `data-invalid` (`.Search`), `data-empty` (`.List`).

## Examples

### Default

```tsx
<ChatAgentPicker />
```

### Composed

Eject to the same public composition the preset renders, mapping options with the public helper:

```tsx
function MyAgentPicker() {
  const { agents } = useAgents()
  const options = agentsToPickerOptions(agents)
  return (
    <AgentPicker.Root>
      <AgentPicker.Trigger className="my-trigger">Choose agent</AgentPicker.Trigger>
      <AgentPicker.Content>
        <AgentPicker.Search />
        <AgentPicker.List>
          {options.map((option) => (
            <AgentPicker.Item key={option.id}>{option.label}</AgentPicker.Item>
          ))}
        </AgentPicker.List>
      </AgentPicker.Content>
    </AgentPicker.Root>
  )
}
```

### Headless

Skip the components entirely — [`useAgents`](../hooks/use-agents.md) + [`useAgentPicker`](../hooks/use-agent-picker.md) + your own markup:

```tsx
function MyPickerList() {
  const picker = useAgentPicker()
  return picker.options.map((option) => (
    <button key={option.id} onClick={() => picker.select(option)}>
      {option.label}
    </button>
  ))
}
```

## Customization (eject path)

1. **L1** — `<ChatAgentPicker />` as-is.
2. **L2** — paste the preset's public `AgentPicker` composition (identical output — same code path) and edit one piece; `agentsToPickerOptions` keeps your options identical to the preset's.
3. **L3** — [`useAgentPicker()`](../hooks/use-agent-picker.md) drives elements you render yourself.

## Related

- [`AgentPicker`](./agent-picker.md) — the compound this preset composes
- [`useAgentPicker`](../hooks/use-agent-picker.md)
- [`useAgents`](../hooks/use-agents.md)
