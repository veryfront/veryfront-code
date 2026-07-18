# Reasoning

A disclosure for a model's reasoning part — auto-opens while streaming, auto-closes when done.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`Reasoning` is the same component as `Message.Reasoning`'s disclosure family — a namespace re-export for use outside a `Message`, never a parallel implementation.

## Import

```tsx
import { Reasoning } from 'veryfront/chat'
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`.

```tsx
<Reasoning.Root>
  <Reasoning.Trigger />
  <Reasoning.Content />
</Reasoning.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `Reasoning.Root` | `<div>` | `data-open` `data-streaming` | Disclosure root. Auto-open while streaming, auto-close when done. |
| `Reasoning.Trigger` | `<button>` | `data-open` | Toggles the content. |
| `Reasoning.Content` | `<div>` | — | The reasoning text. |

## Props (`Reasoning.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the root node onto your own element. |
| …rest | native `<div>` attributes | Spread onto the root — `className`, `data-*`, `aria-*`, handlers, `ref`. |

Inside a `Message`, the reasoning part reaches the component through the message context (`Message.Reasoning part={part}` in the `Message.Parts` render fn).

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-open` | present | Expanded. Automatically set while the reasoning is streaming; automatically removed when done. |
| `data-streaming` | present | The reasoning content is streaming now. |

```css
[data-streaming] .shimmer { animation: shimmer 1.2s infinite; }
[data-open] .chevron { rotate: 180deg; }
```

## Examples

### Default

Rendered by the default part renderer inside `<Chat>` / `ChatMessageList` for reasoning parts.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<Message.Parts>
  {(part) =>
    isReasoningPart(part) ? (
      <Reasoning.Root className="my-reasoning">
        <Reasoning.Trigger className="my-reasoning-trigger">Thinking…</Reasoning.Trigger>
        <Reasoning.Content className="my-reasoning-content" />
      </Reasoning.Root>
    ) : (
      <Message.Text part={part} />
    )}
</Message.Parts>
```

### Headless (L3)

```tsx
function MyReasoning() {
  const reasoning = useReasoning()
  return (
    <div className="anything" data-open={reasoning.open || undefined}>
      <button {...reasoning.getTriggerProps()} className="anything">
        {reasoning.isStreaming ? 'Thinking…' : `Thought for ${reasoning.duration}s`}
      </button>
      {reasoning.open && <div {...reasoning.getContentProps()} className="anything" />}
    </div>
  )
}
```

`useReasoning()` returns `{ open, toggle, isStreaming, duration, getTriggerProps, getContentProps }`.

## Customization (eject path)

1. **L1:** the default reasoning rendering is part of the public `<Chat>` composition — paste it to change it.
2. **L2:** handle reasoning parts in your `Message.Parts` render fn and compose `Reasoning.*` your way; swap any node via `asChild`.
3. **L3:** `useReasoning()` + your own elements via the prop getters.

## Related

- [`useReasoning`](../hooks/use-reasoning.md) — open state, streaming, duration, getters
- [`useMessageParts`](../hooks/use-message-parts.md) — part iteration (`isReasoningPart` guard)
- [Message](./message.md) — hosts reasoning parts via `Message.Reasoning`
