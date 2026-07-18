# ChatEmptyState

The zero-messages view: agent avatar, heading, and typed prompt suggestions.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

## Import

```tsx
import { ChatEmptyState, getAgentPromptSuggestionItems } from 'veryfront/chat'
```

## Anatomy

```tsx
<ChatEmptyState.Root>
  <ChatEmptyState.Avatar />
  <ChatEmptyState.Heading />
  <ChatEmptyState.Suggestions>
    <ChatEmptyState.Suggestion />
  </ChatEmptyState.Suggestions>
</ChatEmptyState.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `ChatEmptyState.Root` | `<div>` | — | The empty-state container. |
| `ChatEmptyState.Avatar` | `<div>` | — | The agent's avatar. |
| `ChatEmptyState.Heading` | `<h2>` | — | The heading. |
| `ChatEmptyState.Suggestions` | `<div>` | `data-empty` | Container for the prompt suggestions. |
| `ChatEmptyState.Suggestion` | `<button>` | — | One prompt suggestion. |

## Props

Every part follows the library-wide node contract: `extends` its element's native React attributes, spreads `{...props}` onto its single node, takes `asChild` and `ref`; `className` merges Tailwind-aware; handlers compose (consumer first, `preventDefault` cancels internal).

### Typed suggestions

Suggestions come **typed**, not as raw strings:

```ts
getAgentPromptSuggestionItems(agent) // → { label: string; prompt: string }[]
```

This helper is public (issue #2978). Selection hands the **item** back — `{ label, prompt }` — so there is no `.find` massaging to recover the prompt from a clicked label. (The lossy `getAgentPromptSuggestions(agent) → string[]` remains only for compatibility.)

## State attributes

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-empty` | `.Suggestions` | Zero suggestion items. |

## Examples

### Default

Rendered inside the `<Chat />` preset (as `Chat.Empty`) when the transcript has no messages.

### Composed

Map the typed items onto `.Suggestion` — the item is in hand at click time:

```tsx
function EmptyState({ agent }: { agent: Agent }) {
  const chat = useChatContext()
  const items = getAgentPromptSuggestionItems(agent)
  return (
    <ChatEmptyState.Root className="my-empty">
      <ChatEmptyState.Avatar />
      <ChatEmptyState.Heading>How can I help?</ChatEmptyState.Heading>
      <ChatEmptyState.Suggestions className="my-grid">
        {items.map((item) => (
          <ChatEmptyState.Suggestion
            key={item.label}
            onClick={() => chat.sendMessage(item.prompt)}
          >
            {item.label}
          </ChatEmptyState.Suggestion>
        ))}
      </ChatEmptyState.Suggestions>
    </ChatEmptyState.Root>
  )
}
```

### Headless

The suggestion data is a pure helper — no hook required. Render anything:

```tsx
const items = getAgentPromptSuggestionItems(agent)

<div className="anything">
  {items.map((item) => (
    <button key={item.label} onClick={() => chat.sendMessage(item.prompt)}>
      {item.label}
    </button>
  ))}
</div>
```

## Customization (eject path)

1. **L1** — the default empty state inside `<Chat />`.
2. **L2** — paste the public composition; every part is a single node (`asChild`, `className`, `data-*`) and the layout divs are yours.
3. **L3** — `getAgentPromptSuggestionItems(agent)` + your own markup; nothing else is needed.

## Related

- `Chat` — the L1 preset (`Chat.Empty`)
- [`useAgentMetadata`](../hooks/use-agent-metadata.md) — source of the `agent` passed to the helper
- `getAgentPromptSuggestionItems` / `getAgentPromptSuggestions` — helpers
