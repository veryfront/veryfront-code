# ChatAgentPicker

The batteries-included preset over `AgentPicker`: fetches the project's agents itself and renders the picker only when there is something to switch between.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatAgentPicker, agentsToPickerOptions } from 'veryfront/chat'
```

## Anatomy

`ChatAgentPicker` is a **preset**, not a compound: it has no parts of its own. It runs [`useAgents`](../hooks/use-agents.md), maps the result through `agentsToPickerOptions`, and renders the public [`AgentPicker`](./agent-picker.md) preset — so ejecting means pasting that composition (identical output, same code path):

```tsx
<ChatAgentPicker value={agentId} onValueChange={setAgentId} />

// is exactly:
function ChatAgentPicker({ value, onValueChange, minAgents = 2, enabled = true, onCreate, onManage }) {
  const { agents } = useAgents({ enabled })
  const options = agentsToPickerOptions(agents)   // public helper
  if (options.length < minAgents) return null     // nothing to switch to → no node
  return (
    <AgentPicker agents={options} value={value} onValueChange={onValueChange}
      onCreate={onCreate} onManage={onManage} />
  )
}
```

## Default DOM (childless render)

`ChatAgentPicker` contributes **zero nodes of its own** — its rendered DOM is exactly the [`AgentPicker` default DOM](./agent-picker.md#default-dom-childless-render) (anchor `<span>` → Pill trigger → portalled panel with search/list/action rows), or **nothing at all**:

```html
<!-- fewer than minAgents (default 2) available — incl. while the fetch is
     in flight or after an error (both leave `agents` empty): -->
<!-- (no DOM) -->

<!-- otherwise: the AgentPicker preset DOM, verbatim -->
<span class="relative inline-block">                 <!-- AgentPicker.Root anchor wrapper -->
  <button class="inline-flex h-9 items-center gap-1.5 rounded-full px-3">…</button>  <!-- pill trigger -->
  <div role="dialog" class="z-50 min-w-[280px] …">…</div>  <!-- portalled panel, while open -->
</span>
```

**Layout:** in-flow inline-flex pill wherever you place it (designed to drop into a composer toolbar); the panel is a fixed-position portal. The null render means the surrounding toolbar slot collapses cleanly in single-agent projects.

## Parts

### `ChatAgentPicker`

The whole preset — one component, no sub-parts. **Layout: whatever `AgentPicker` renders (or nothing).**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `value` | `string` | — | Selected agent id (controlled) |
| `onValueChange` | `(id: string) => void` | — | Called with the chosen agent id |
| `minAgents` | `number` | `2` | Minimum agent count before it renders — with one agent there is nothing to switch to; set `1` to always show once an agent exists |
| `enabled` | `boolean` | `true` | `false` skips the fetch and renders nothing |
| `onCreate` / `onManage` | `() => void` | — | Forwarded to `AgentPicker` — enables its `.Create` / `.Manage` rows |
| + native *(proposed)* | `HTMLAttributes` · `asChild` · `ref` | — | Pending the popper-anchor decision (the preset's outer node is `AgentPicker.Root`'s) |

**Removed (proposed):** `className` (today it aliases the trigger's class through two layers — the node contract bans the indirection; eject to the composition and class `AgentPicker.Trigger` directly). Boolean state props from the underlying surface (`selected` / `isLoading` / `invalid`) become `data-*`; `inputStyle` is deleted (see [`AgentPicker`](./agent-picker.md)).

**Null-render conditions:** fewer than `minAgents` options — which includes *while loading* and *on fetch error* (both leave the agents list empty). There is no spinner state at this level; the picker simply appears when the data does.

## Context (what the parts read)

None of its own. Inside, the standard [`useAgentPicker()`](../hooks/use-agent-picker.md) context is available to any composed children; the data layer is [`useAgents({ enabled })`](../hooks/use-agents.md) → `{ agents, isLoading, error, refetch }`.

### `agentsToPickerOptions` (public helper)

The pure mapping the preset uses, exported so your composed picker's options match the preset's exactly:

```ts
agentsToPickerOptions(agents: AgentMetadata[]): AgentOption[]
// keeps { id, name, avatarUrl }; drops the metadata fields the rows don't use
```

## State attributes

Inherited from `AgentPicker` (this preset adds none): `data-open` (`.Trigger`), `data-active` (`.Item`), `data-invalid` (`.Search`), `data-empty` / `data-loading` (`.List`).

## Examples

### Default

```tsx
const [agentId, setAgentId] = React.useState<string>()
<ChatAgentPicker value={agentId} onValueChange={setAgentId} />
```

### Composed — eject to the same public composition

```tsx
function MyAgentPicker() {
  const { agents } = useAgents()
  const options = agentsToPickerOptions(agents)
  if (options.length < 2) return null
  return (
    <AgentPicker.Root agents={options} value={agentId} onValueChange={setAgentId}>
      <AgentPicker.Trigger className="my-trigger" />
      <AgentPicker.Content>
        <AgentPicker.Search />
        <AgentPicker.List>
          {options.map((option) => <AgentPicker.Item key={option.id} agent={option} />)}
        </AgentPicker.List>
      </AgentPicker.Content>
    </AgentPicker.Root>
  )
}
```

### Headless

```tsx
function MyPickerList() {
  const picker = useAgentPicker()
  return picker.options.map((option) => (
    <button key={option.id} onClick={() => picker.select(option)}
      data-active={option.id === picker.value || undefined}>
      {option.name}
    </button>
  ))
}
```

## Customization (eject path)

1. **L1** — `<ChatAgentPicker />` as-is.
2. **L2** — paste the preset's public composition (printed under *Anatomy* — it is the whole component) and edit one piece; `agentsToPickerOptions` keeps your options identical to the preset's.
3. **L3** — [`useAgents`](../hooks/use-agents.md) + [`useAgentPicker()`](../hooks/use-agent-picker.md) driving elements you render yourself.

## Related

- [`AgentPicker`](./agent-picker.md) — the compound this preset composes (parts, DOM, popper open question)
- [`useAgentPicker`](../hooks/use-agent-picker.md) · [`useAgents`](../hooks/use-agents.md)
