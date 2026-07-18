# Sources

The citation list for a message, extracted from its source parts.

> **Status: proposed (RFC).** This page documents the *proposed* API shape — not yet implemented. Full rationale: [`29-chat-api-shape.md`](../../29-chat-api-shape.md).

`Sources` is the same component as `Message.Sources` — a namespace re-export for use outside a `Message`, never a parallel implementation. `Message.*` is canonical.

## Import

```tsx
import { Sources } from 'veryfront/chat'
```

## Anatomy

Each part renders one node, `extends` its native attributes, spreads `{...props}`, and takes `asChild`.

```tsx
<Sources.Root>
  <Sources.List>
    <Sources.Pill />
  </Sources.List>
</Sources.Root>
```

## Parts

| Part | Renders | State attributes | Description |
| --- | --- | --- | --- |
| `Sources.Root` | `<div>` | `data-open` `data-empty` | Container; `data-empty` when the message has no sources. As `Message.Sources`, the node is a `<section>`. |
| `Sources.List` | `<ul>` | — | The citation list. |
| `Sources.Pill` | `<a>` | — | One source link. Display-only leaf — no prop getter needed. |

## Props (`Sources.Root`)

| Prop | Type | Description |
| --- | --- | --- |
| `asChild` | `boolean` | Merge the root node onto your own element. |
| …rest | native attributes of the root node | Spread onto the root — `className`, `data-*`, `aria-*`, handlers, `ref`. |

Inside a `Message`, the source list comes from the message context. At L3, pass the message explicitly to `useSources(message)` — the usual precedence: explicit prop > nearest context > default.

## State attributes

| Attribute | Values | Meaning |
| --- | --- | --- |
| `data-open` | present | Expanded. |
| `data-empty` | present | Zero sources. |

```css
[data-empty] { display: none; }
```

## Examples

### Default

Rendered as part of the public `<Chat>` composition when a message carries source parts.

```tsx
<Chat agentId="support-agent" api="/api/ag-ui" />
```

### Composed (L2)

```tsx
<Message.Root message={m}>
  <Message.Content>
    <Message.Parts>{(part) => <Message.Text part={part} />}</Message.Parts>
    <Sources.Root className="my-sources">
      <Sources.List className="my-sources-list">
        <Sources.Pill className="my-source-pill" />
      </Sources.List>
    </Sources.Root>
  </Message.Content>
</Message.Root>
```

### Headless (L3)

```tsx
function MySources({ message }: { message: ChatMessage }) {
  const { sources, isEmpty } = useSources(message)
  if (isEmpty) return null
  return (
    <ul className="anything">
      {sources.map((source) => (
        <li key={source.url}>
          <a href={source.url}>{source.title}</a>
        </li>
      ))}
    </ul>
  )
}
```

`useSources(message?)` — message explicit at L3, from context at L2 — returns `{ sources, isEmpty }` over the pure helper `extractSourcesFromParts(parts)`, which is also exported for direct use.

## Customization (eject path)

1. **L1:** paste the public `<Chat>` composition and edit the sources block.
2. **L2:** compose `Sources.*` with your own layout; swap any node via `asChild`.
3. **L3:** `useSources(message)` — or `extractSourcesFromParts` directly — and your own markup.

## Related

- [`useSources`](../hooks/use-sources.md) — citation list + empty state
- [InlineCitation](./inline-citation.md) — inline footnote markers for the same source parts
- [Message](./message.md) — `Message.Sources` is the canonical form
