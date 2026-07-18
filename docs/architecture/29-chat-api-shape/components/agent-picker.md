# AgentPicker

A searchable popover for choosing an agent, with optional create and manage actions.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { AgentPicker } from 'veryfront/chat'
```

## Anatomy

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

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `AgentPicker.Root` | provider (popper root) | — | Scoped context provider for the compound. Positions `.Content` relative to `.Trigger`. See [Popper anchor](#popper-anchor) below. |
| `AgentPicker.Trigger` | `<button>` | `data-open` | Opens and closes the picker. |
| `AgentPicker.Content` | `<div>` | — | The popover panel. |
| `AgentPicker.Search` | `<input>` | `data-invalid` | Filter input driving the option query. `data-invalid` is kept from today's surface (validation failed). |
| `AgentPicker.List` | `<ul>` | `data-empty` | Option list container. `data-empty` per the global list-container vocabulary. |
| `AgentPicker.Item` | `<button>` | `data-active` | One selectable agent option. `data-active` marks the current selection. |
| `AgentPicker.Create` | `<button>` | — | "Create a new agent" action. |
| `AgentPicker.Manage` | `<button>` | — | "Manage agents" action. |

## Props

Every part follows the library-wide node contract:

- `extends` the native React attributes of its element (e.g. `.Item` extends `React.ButtonHTMLAttributes<HTMLButtonElement>`) and spreads `{...props}` onto its single node — `className`, `style`, `data-*`, `aria-*`, `id`, and event handlers are all yours.
- `asChild` — merge the part's behavior and accessibility onto your own element.
- `ref` is a regular prop (React 19) and composes with internal refs.
- `className` merges Tailwind-aware (consumer wins); event handlers compose (consumer first, `event.preventDefault()` cancels the internal handler).

### Removed from today's API

| Removed | Replacement |
| --- | --- |
| `selected` (boolean prop) | `data-active` on `.Item` |
| `isLoading` (boolean prop) | `data-*` state (see the global `data-*` contract) |
| `invalid` (boolean prop) | `data-invalid` |
| `inputStyle` | Deleted — style the `.Search` node directly (`className`, `style`, `asChild`). |

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-open` | `.Trigger` | Picker is expanded. |
| `data-active` | `.Item` | Item is the current selection. |
| `data-invalid` | `.Search` | Validation failed (kept from today). |
| `data-empty` | `.List` | Zero options. |

## Examples

### Default

The batteries-included appearance ships as the [`ChatAgentPicker`](./chat-agent-picker.md) preset:

```tsx
<ChatAgentPicker />
```

### Composed

You own every layout node between the parts; config flows through `.Root` context to the parts:

```tsx
<AgentPicker.Root>
  <AgentPicker.Trigger className="my-trigger">Choose agent</AgentPicker.Trigger>
  <AgentPicker.Content className="my-panel">
    <AgentPicker.Search placeholder="Search agents…" />
    <AgentPicker.List>
      {/* default item rendering, or map options to <AgentPicker.Item> yourself */}
    </AgentPicker.List>
    <div className="my-footer">{/* YOUR div */}
      <AgentPicker.Create>New agent</AgentPicker.Create>
      <AgentPicker.Manage>Manage</AgentPicker.Manage>
    </div>
  </AgentPicker.Content>
</AgentPicker.Root>
```

### Headless

[`useAgentPicker()`](../hooks/use-agent-picker.md) is the compound's context reader, exposing `{ query, setQuery, options, select }` — render the options yourself:

```tsx
function MyAgentList() {
  const picker = useAgentPicker()
  return (
    <>
      <input
        value={picker.query}
        onChange={(event) => picker.setQuery(event.target.value)}
        className="anything"
      />
      <ul className="anything">
        {picker.options.map((option) => (
          <li key={option.id}>
            <button onClick={() => picker.select(option)}>{option.label}</button>
          </li>
        ))}
      </ul>
    </>
  )
}
```

## Customization (eject path)

1. **L1** — use the [`ChatAgentPicker`](./chat-agent-picker.md) preset as-is.
2. **L2** — paste the preset's public composition and edit the pieces you care about; every part is a single node you can class, attribute, or retag (`asChild`).
3. **L3** — replace any part (or the whole option list) with your own elements driven by [`useAgentPicker()`](../hooks/use-agent-picker.md); [`agentsToPickerOptions`](./chat-agent-picker.md) maps agents to options.

### Popper anchor

Open question in the RFC: popper roots today (including `veryfront/ui`'s `DropdownMenu`) render a wrapper `<span>` anchor node. Either `ui` fixes this (Floating UI can anchor to the trigger ref) or a narrow "positioning anchor" exception to the node contract is sanctioned for popper roots. `AgentPicker.Root` depends on that decision.

## Related

- [`ChatAgentPicker`](./chat-agent-picker.md) — the preset over this compound
- [`ModelSelector`](./model-selector.md) — same anatomy minus `.Create` / `.Manage`
- [`useAgentPicker`](../hooks/use-agent-picker.md)
- [`useAgents`](../hooks/use-agents.md)
